/**
 * Chrome DevTools Protocol (CDP) integration.
 *
 * How it works:
 *  1. Start Chrome with --remote-debugging-port=9222
 *  2. We connect via chrome-remote-interface
 *  3. Enable Network domain to intercept all HTTP responses
 *  4. When a response contains "phpdebugbar-id" or "x-debugbar-id" header,
 *     we fire a callback with the request ID
 *  5. The caller fetches full debugbar data from the PHP server using that ID
 *
 * For Cursor built-in preview: the webview uses Chromium, which exposes
 * DevTools on a configurable port. Use the same chrome port approach.
 */

import CDP from 'chrome-remote-interface';
import { log } from '../logger.js';

type CdpClient = Awaited<ReturnType<typeof CDP>>;

// CDP types from chrome-remote-interface (subset of what we need)
interface ResponseReceivedEvent {
  requestId: string;
  frameId?: string;
  loaderId?: string;
  timestamp?: number;
  type?: string;
  response: {
    url: string;
    status: number;
    headers: Record<string, string>;
  };
}

interface ResponseReceivedExtraInfoEvent {
  requestId: string;
  headers: Record<string, string>;
  statusCode: number;
}

export interface DebugBarCaptureEvent {
  requestId: string;
  debugbarId: string;
  url: string;
  statusCode: number;
  method: string;
}

export interface ChromeMonitor {
  stop: () => Promise<void>;
  isRunning: boolean;
}

// ─── Low-level tab discovery ──────────────────────────────────────────────

export async function listChromeTabs(
  host = 'localhost',
  port = 9222,
): Promise<{ id: string; url: string; title: string; type: string }[]> {
  try {
    const targets = await CDP.List({ host, port }) as unknown as {
      id: string;
      url: string;
      title: string;
      type: string;
    }[];
    return targets ?? [];
  } catch (err) {
    throw new Error(
      `Cannot reach Chrome DevTools on ${host}:${port}. ` +
        `Start Chrome with: --remote-debugging-port=${port}\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Check connectivity ───────────────────────────────────────────────────

export async function pingChrome(host = 'localhost', port = 9222): Promise<boolean> {
  try {
    await CDP.Version({ host, port });
    return true;
  } catch {
    return false;
  }
}

export async function getChromeVersion(host = 'localhost', port = 9222): Promise<string> {
  try {
    const version = await CDP.Version({ host, port }) as unknown as {
      Browser: string;
      'Protocol-Version': string;
      'V8-Version': string;
      'WebKit-Version': string;
    };
    return `${version.Browser} (Protocol ${version['Protocol-Version']})`;
  } catch {
    return 'Unknown';
  }
}

// ─── Start monitoring ─────────────────────────────────────────────────────

export async function startChromeMonitor(
  host: string,
  port: number,
  baseUrl: string,
  onCapture: (event: DebugBarCaptureEvent) => void,
): Promise<ChromeMonitor> {
  log.info(`Connecting to Chrome CDP at ${host}:${port}`);

  let client: CdpClient;
  try {
    client = await CDP({ host, port });
  } catch (err) {
    throw new Error(
      `Failed to connect to Chrome at ${host}:${port}. ` +
        `Make sure Chrome is running with --remote-debugging-port=${port}. ` +
        `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { Network } = client;

  await Network.enable({});
  log.info('Chrome Network monitoring enabled');

  // Normalise base URL for matching
  const normalizedBase = baseUrl.replace(/\/$/, '').toLowerCase();

  // Track request methods by requestId
  const requestMethods = new Map<string, string>();

  // Track request URLs
  const requestUrls = new Map<string, string>();

  // requestWillBeSent gives us method + URL before response
  (client as unknown as {
    on(event: string, cb: (params: unknown) => void): void;
  }).on('Network.requestWillBeSent', (params: unknown) => {
    const p = params as { requestId: string; request: { url: string; method: string } };
    requestMethods.set(p.requestId, p.request.method);
    requestUrls.set(p.requestId, p.request.url);
  });

  // Primary: responseReceived has headers for most cases
  (client as unknown as {
    on(event: string, cb: (params: unknown) => void): void;
  }).on('Network.responseReceived', (params: unknown) => {
    const p = params as ResponseReceivedEvent;
    const headers = normalizeHeaders(p.response.headers);
    const debugbarId = extractDebugbarId(headers);

    if (!debugbarId) return;

    const url = p.response.url;
    if (!url.toLowerCase().startsWith(normalizedBase)) return;

    // Skip the debugbar's own open-handler requests
    if (url.includes('/_debugbar/') || url.includes('/debugbar/')) return;

    const method = requestMethods.get(p.requestId) ?? 'GET';
    log.info(`Chrome captured debugbar ID=${debugbarId} for ${method} ${url}`);

    onCapture({
      requestId: p.requestId,
      debugbarId,
      url,
      statusCode: p.response.status,
      method,
    });
  });

  // Fallback: responseReceivedExtraInfo may have headers when compressed
  (client as unknown as {
    on(event: string, cb: (params: unknown) => void): void;
  }).on('Network.responseReceivedExtraInfo', (params: unknown) => {
    const p = params as ResponseReceivedExtraInfoEvent;
    const headers = normalizeHeaders(p.headers);
    const debugbarId = extractDebugbarId(headers);

    if (!debugbarId) return;

    const url = requestUrls.get(p.requestId) ?? '';
    if (!url.toLowerCase().startsWith(normalizedBase)) return;
    if (url.includes('/_debugbar/') || url.includes('/debugbar/')) return;

    const method = requestMethods.get(p.requestId) ?? 'GET';
    log.info(`Chrome (extraInfo) captured debugbar ID=${debugbarId} for ${method} ${url}`);

    onCapture({
      requestId: p.requestId,
      debugbarId,
      url,
      statusCode: p.statusCode,
      method,
    });
  });

  // Clean up old entries to avoid memory leak
  setInterval(() => {
    if (requestMethods.size > 2000) {
      const keys = [...requestMethods.keys()].slice(0, 500);
      keys.forEach(k => {
        requestMethods.delete(k);
        requestUrls.delete(k);
      });
    }
  }, 60_000);

  let isRunning = true;

  const monitor: ChromeMonitor = {
    get isRunning() {
      return isRunning;
    },
    async stop() {
      isRunning = false;
      try {
        await Network.disable();
        await client.close();
        log.info('Chrome monitor stopped');
      } catch (err) {
        log.warn(`Error closing Chrome CDP client: ${err}`);
      }
    },
  };

  return monitor;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function extractDebugbarId(headers: Record<string, string>): string | null {
  return (
    headers['phpdebugbar-id'] ||
    headers['x-debugbar-id'] ||
    headers['x-phpdebugbar-id'] ||
    null
  );
}

// ─── Screenshot helper for Cursor preview ─────────────────────────────────

export async function captureScreenshot(
  host: string,
  port: number,
  url?: string,
): Promise<string | null> {
  let client: CdpClient | null = null;
  try {
    client = await CDP({ host, port });
    const { Page } = client;
    await Page.enable();

    if (url) {
      await Page.navigate({ url });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const result = await Page.captureScreenshot({ format: 'png' });
    return result.data;
  } catch (err) {
    log.error(`Screenshot failed: ${err}`);
    return null;
  } finally {
    if (client) await client.close().catch(() => {});
  }
}
