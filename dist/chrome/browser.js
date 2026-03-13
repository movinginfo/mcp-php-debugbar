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
// ─── Low-level tab discovery ──────────────────────────────────────────────
export async function listChromeTabs(host = 'localhost', port = 9222) {
    try {
        const targets = await CDP.List({ host, port });
        return targets ?? [];
    }
    catch (err) {
        throw new Error(`Cannot reach Chrome DevTools on ${host}:${port}. ` +
            `Start Chrome with: --remote-debugging-port=${port}\n` +
            `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
}
// ─── Check connectivity ───────────────────────────────────────────────────
export async function pingChrome(host = 'localhost', port = 9222) {
    try {
        await CDP.Version({ host, port });
        return true;
    }
    catch {
        return false;
    }
}
export async function getChromeVersion(host = 'localhost', port = 9222) {
    try {
        const version = await CDP.Version({ host, port });
        return `${version.Browser} (Protocol ${version['Protocol-Version']})`;
    }
    catch {
        return 'Unknown';
    }
}
// ─── Start monitoring ─────────────────────────────────────────────────────
export async function startChromeMonitor(host, port, baseUrl, onCapture) {
    log.info(`Connecting to Chrome CDP at ${host}:${port}`);
    let client;
    try {
        client = await CDP({ host, port });
    }
    catch (err) {
        throw new Error(`Failed to connect to Chrome at ${host}:${port}. ` +
            `Make sure Chrome is running with --remote-debugging-port=${port}. ` +
            `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { Network } = client;
    await Network.enable({});
    log.info('Chrome Network monitoring enabled');
    // Normalise base URL for matching
    const normalizedBase = baseUrl.replace(/\/$/, '').toLowerCase();
    // Track request methods by requestId
    const requestMethods = new Map();
    // Track request URLs
    const requestUrls = new Map();
    // requestWillBeSent gives us method + URL before response
    client.on('Network.requestWillBeSent', (params) => {
        const p = params;
        requestMethods.set(p.requestId, p.request.method);
        requestUrls.set(p.requestId, p.request.url);
    });
    // Primary: responseReceived has headers for most cases
    client.on('Network.responseReceived', (params) => {
        const p = params;
        const headers = normalizeHeaders(p.response.headers);
        const debugbarId = extractDebugbarId(headers);
        if (!debugbarId)
            return;
        const url = p.response.url;
        if (!url.toLowerCase().startsWith(normalizedBase))
            return;
        // Skip the debugbar's own open-handler requests
        if (url.includes('/_debugbar/') || url.includes('/debugbar/'))
            return;
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
    client.on('Network.responseReceivedExtraInfo', (params) => {
        const p = params;
        const headers = normalizeHeaders(p.headers);
        const debugbarId = extractDebugbarId(headers);
        if (!debugbarId)
            return;
        const url = requestUrls.get(p.requestId) ?? '';
        if (!url.toLowerCase().startsWith(normalizedBase))
            return;
        if (url.includes('/_debugbar/') || url.includes('/debugbar/'))
            return;
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
    const monitor = {
        get isRunning() {
            return isRunning;
        },
        async stop() {
            isRunning = false;
            try {
                await Network.disable();
                await client.close();
                log.info('Chrome monitor stopped');
            }
            catch (err) {
                log.warn(`Error closing Chrome CDP client: ${err}`);
            }
        },
    };
    return monitor;
}
// ─── Helpers ───────────────────────────────────────────────────────────────
function normalizeHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
        normalized[key.toLowerCase()] = value;
    }
    return normalized;
}
function extractDebugbarId(headers) {
    return (headers['phpdebugbar-id'] ||
        headers['x-debugbar-id'] ||
        headers['x-phpdebugbar-id'] ||
        null);
}
// ─── Screenshot helper for Cursor preview ─────────────────────────────────
export async function captureScreenshot(host, port, url) {
    let client = null;
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
    }
    catch (err) {
        log.error(`Screenshot failed: ${err}`);
        return null;
    }
    finally {
        if (client)
            await client.close().catch(() => { });
    }
}
//# sourceMappingURL=browser.js.map