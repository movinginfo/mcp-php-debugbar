/**
 * Cursor IDE + Chrome Preview Integration
 *
 * How Cursor preview works with PHP DebugBar:
 *
 * OPTION A — Cursor built-in "Simple Browser"
 *   • Cursor's webview (Simple Browser) does NOT expose Chrome DevTools Protocol.
 *   • DebugBar toolbar IS rendered inside the webview (visual only).
 *   • To capture debug data programmatically, use polling mode:
 *     the MCP server polls /_debugbar/open periodically for new requests.
 *
 * OPTION B — Chrome with remote debugging (RECOMMENDED for full CDP support)
 *   • Start Chrome with --remote-debugging-port=9222
 *   • MCP server connects via CDP and automatically captures every request.
 *   • Every page visit → phpdebugbar-id header → instant debug data.
 *
 * OPTION C — VS Code / Cursor "Preview" extension with user script
 *   • Inject a small snippet into the page that POSTs debug IDs to a local
 *     webhook receiver, which the MCP server listens to.
 *
 * This module provides:
 *   - Instructions and launch commands for each mode
 *   - A polling manager for Cursor Simple Browser mode
 *   - Webhook receiver for the injected script mode
 */

import * as http from 'http';
import { fetchRequestList, fetchRequestData } from '../debugbar/client.js';
import { state } from '../state.js';
import { log } from '../logger.js';
import { CapturedRequest } from '../debugbar/types.js';

// ─── Preview launch instructions ─────────────────────────────────────────

export interface PreviewMode {
  name: string;
  description: string;
  setupSteps: string[];
  launchCommand?: string;
  proAndCons: { pros: string[]; cons: string[] };
}

export const PREVIEW_MODES: Record<string, PreviewMode> = {
  'cursor-simple-browser': {
    name: 'Cursor Simple Browser (Polling)',
    description: 'Use Cursor\'s built-in webview with polling for debug data.',
    setupSteps: [
      '1. Make sure PHP server is running: php -S localhost:8000 -t public',
      '2. In Cursor: Ctrl+Shift+P → "Simple Browser: Show"',
      '3. Enter URL: http://localhost:8000',
      '4. Use debugbar_start_polling() to auto-capture requests',
      '5. Browse the site in the Simple Browser panel',
    ],
    launchCommand: 'cursor://simpleBrowser/show?url=http://localhost:8000',
    proAndCons: {
      pros: ['No Chrome needed', 'Built into Cursor', 'DebugBar toolbar visible'],
      cons: ['No CDP support', 'Polling has delay (~2s)', 'Cannot intercept AJAX automatically'],
    },
  },
  'chrome-cdp': {
    name: 'Chrome with CDP (Recommended)',
    description: 'Full Chrome DevTools Protocol support — zero-delay automatic capture.',
    setupSteps: [
      '1. Start Chrome with remote debugging:',
      '   Windows: chrome.exe --remote-debugging-port=9222 --new-window http://localhost:8000',
      '   macOS:   open -a "Google Chrome" --args --remote-debugging-port=9222 http://localhost:8000',
      '   Linux:   google-chrome --remote-debugging-port=9222 http://localhost:8000',
      '',
      '2. In MCP server:',
      '   debugbar_connect(base_url="http://localhost:8000", chrome_port=9222)',
      '',
      '3. Browse the site — requests are captured automatically!',
    ],
    launchCommand: 'chrome.exe --remote-debugging-port=9222 --new-window http://localhost:8000',
    proAndCons: {
      pros: ['Real-time capture', 'Full CDP access', 'Works with AJAX', 'Screenshot support'],
      cons: ['Requires Chrome', 'Must start Chrome with special flag'],
    },
  },
  'edge-cdp': {
    name: 'Microsoft Edge with CDP',
    description: 'Same as Chrome but using Edge (also Chromium-based).',
    setupSteps: [
      '1. Start Edge with remote debugging:',
      '   Windows: msedge.exe --remote-debugging-port=9222 --new-window http://localhost:8000',
      '2. Run: debugbar_connect(base_url="http://localhost:8000", chrome_port=9222)',
    ],
    launchCommand: 'msedge.exe --remote-debugging-port=9222 --new-window http://localhost:8000',
    proAndCons: {
      pros: ['Same as Chrome CDP', 'Pre-installed on Windows'],
      cons: ['Must start Edge with special flag'],
    },
  },
};

// ─── Generate launch command for current OS ───────────────────────────────

export function getLaunchCommands(
  url: string,
  cdpPort = 9222,
  browser: 'chrome' | 'edge' | 'chromium' = 'chrome',
): {
  windows: string;
  macos: string;
  linux: string;
  cursor: string;
} {
  const flags = `--remote-debugging-port=${cdpPort} --new-window "${url}"`;

  const cmds = {
    chrome: {
      windows: `Start-Process "chrome.exe" -ArgumentList "${flags}"`,
      macos: `open -a "Google Chrome" --args --remote-debugging-port=${cdpPort} "${url}"`,
      linux: `google-chrome --remote-debugging-port=${cdpPort} "${url}" &`,
    },
    edge: {
      windows: `Start-Process "msedge.exe" -ArgumentList "${flags}"`,
      macos: `open -a "Microsoft Edge" --args --remote-debugging-port=${cdpPort} "${url}"`,
      linux: `microsoft-edge --remote-debugging-port=${cdpPort} "${url}" &`,
    },
    chromium: {
      windows: `Start-Process "chromium.exe" -ArgumentList "${flags}"`,
      macos: `open -a "Chromium" --args --remote-debugging-port=${cdpPort} "${url}"`,
      linux: `chromium-browser --remote-debugging-port=${cdpPort} "${url}" &`,
    },
  };

  const c = cmds[browser];
  return {
    windows: c.windows,
    macos: c.macos,
    linux: c.linux,
    cursor: `cursor://simpleBrowser/show?url=${encodeURIComponent(url)}`,
  };
}

// ─── Polling Manager ─────────────────────────────────────────────────────
// Used when Chrome CDP is not available (Cursor Simple Browser mode)

export interface PollingManager {
  isRunning: boolean;
  stop: () => void;
  capturedCount: number;
}

export function startPolling(
  intervalMs = 2000,
  onNewRequest?: (req: CapturedRequest) => void,
): PollingManager {
  if (!state.connected || !state.connectionConfig) {
    throw new Error('Not connected to PHP server. Call debugbar_connect first.');
  }

  let running = true;
  let capturedCount = 0;
  const knownIds = new Set(state.requests.map(r => r.id));

  log.info(`Polling for new requests every ${intervalMs}ms`);

  const poll = async () => {
    if (!running || !state.connectionConfig) return;

    try {
      const fresh = await fetchRequestList(state.connectionConfig, 10, 0);
      for (const req of fresh) {
        if (!knownIds.has(req.id)) {
          knownIds.add(req.id);
          // Fetch full data
          try {
            const data = await fetchRequestData(state.connectionConfig, req.id);
            const full = { ...req, data };
            state.addRequest(full);
            capturedCount++;
            log.info(`Poll captured: ${req.method} ${req.uri} [${req.id.slice(0, 12)}]`);
            onNewRequest?.(full);
          } catch {
            state.addRequest(req);
            capturedCount++;
            onNewRequest?.(req);
          }
        }
      }
    } catch (err) {
      log.debug(`Poll error: ${err}`);
    }

    if (running) setTimeout(poll, intervalMs);
  };

  setTimeout(poll, intervalMs);

  const manager: PollingManager = {
    get isRunning() { return running; },
    get capturedCount() { return capturedCount; },
    stop() {
      running = false;
      log.info('Polling stopped');
    },
  };

  return manager;
}

// ─── Webhook receiver ─────────────────────────────────────────────────────
// Small HTTP server that receives POST from injected JS snippet.
// The snippet POSTs the phpdebugbar-id to http://localhost:PORT/__debugbar

export interface WebhookServer {
  port: number;
  stop: () => Promise<void>;
}

export async function startWebhookReceiver(
  port = 9223,
  onCapture?: (id: string, url: string) => void,
): Promise<WebhookServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST' || req.url !== '/__debugbar') {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id, url } = JSON.parse(body) as { id: string; url: string };
          log.info(`Webhook received debugbar ID=${id} for ${url}`);
          onCapture?.(id, url);
          res.writeHead(200);
          res.end('ok');
        } catch {
          res.writeHead(400);
          res.end('invalid json');
        }
      });
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      log.info(`Webhook receiver listening on port ${port}`);
      resolve({
        port,
        stop: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}

// ─── JS snippet to inject into pages ─────────────────────────────────────

export function getInjectableScript(webhookPort = 9223): string {
  return `
<!-- MCP DebugBar Bridge — auto-injected -->
<script>
(function() {
  var _orig = window.fetch;
  window.fetch = function(input, init) {
    return _orig.apply(this, arguments).then(function(response) {
      var id = response.headers.get('phpdebugbar-id') || response.headers.get('x-debugbar-id');
      if (id) {
        fetch('http://127.0.0.1:${webhookPort}/__debugbar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, url: response.url })
        }).catch(function(){});
      }
      return response;
    });
  };
  // Also check current page header (injected by PHP)
  var meta = document.querySelector('meta[name="phpdebugbar-id"]');
  if (meta) {
    fetch('http://127.0.0.1:${webhookPort}/__debugbar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meta.content, url: window.location.href })
    }).catch(function(){});
  }
})();
</script>`.trim();
}

export function getPhpInjectSnippet(webhookPort = 9223): string {
  return `<?php
// MCP DebugBar Bridge — add to your layout BEFORE </body>
// This sends the debugbar ID to the MCP webhook so Cursor can capture it.
$debugbarId = $debugbar->getCurrentRequestId();
if ($debugbarId): ?>
<meta name="phpdebugbar-id" content="<?= htmlspecialchars($debugbarId) ?>">
<script>
  fetch('http://127.0.0.1:${webhookPort}/__debugbar', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({id:'<?= $debugbarId ?>',url:window.location.href})
  }).catch(()=>{});
</script>
<?php endif; ?>`;
}
