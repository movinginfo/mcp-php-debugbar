#!/usr/bin/env node
/**
 * MCP PHP DebugBar Server
 *
 * Connects to PHP DebugBar v3.5.1 and Laravel Debugbar v4.1.x,
 * monitors Chrome DevTools Protocol for automatic request capture,
 * and exposes all debug data through MCP tools.
 *
 * Usage:
 *   node dist/index.js
 *   tsx src/index.ts
 *
 * Configure via environment variables or .env file:
 *   DEBUGBAR_BASE_URL=http://localhost:8000
 *   CHROME_PORT=9222
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { log } from './logger.js';
import { config } from './config.js';
import { state } from './state.js';
import {
  probeServer,
  detectProjectType,
  fetchRequestList,
} from './debugbar/client.js';
import {
  startChromeMonitor,
  pingChrome,
} from './chrome/browser.js';
import { fetchRequestData } from './debugbar/client.js';

async function main(): Promise<void> {
  log.info('Starting MCP PHP DebugBar server v1.0.0');
  log.info(`Config: baseUrl="${config.debugbar.baseUrl || '(not set)'}"`);

  const server = createServer();
  const transport = new StdioServerTransport();

  // Auto-connect if DEBUGBAR_BASE_URL is set at startup
  if (config.debugbar.baseUrl) {
    try {
      const baseUrl = config.debugbar.baseUrl;
      const reachable = await probeServer(baseUrl, 5000);

      if (reachable) {
        const type = config.debugbar.type === 'auto'
          ? await detectProjectType(baseUrl, 5000)
          : config.debugbar.type;

        const cfg = {
          baseUrl,
          openHandlerPath: config.debugbar.openHandlerPath,
          type,
          timeout: config.debugbar.timeout,
          chromePort: config.chrome.port,
          chromeHost: config.chrome.host,
        };

        state.connect(cfg);
        log.info(`Auto-connected to ${baseUrl} (type: ${type})`);

        // Load recent requests
        try {
          const requests = await fetchRequestList(cfg, 20, 0);
          state.addRequests(requests);
          log.info(`Loaded ${requests.length} recent requests from server`);
        } catch (err) {
          log.warn(`Could not load recent requests: ${err}`);
        }

        // Auto-connect Chrome if configured
        if (config.chrome.autoConnect) {
          const chromeReachable = await pingChrome(config.chrome.host, config.chrome.port);
          if (chromeReachable) {
            try {
              await startChromeMonitor(
                config.chrome.host,
                config.chrome.port,
                baseUrl,
                async (event) => {
                  try {
                    const data = await fetchRequestData(cfg, event.debugbarId);
                    state.addRequest({
                      id: event.debugbarId,
                      datetime: new Date().toISOString().replace('T', ' ').slice(0, 19),
                      utime: Date.now() / 1000,
                      method: event.method,
                      uri: new URL(event.url).pathname,
                      ip: '127.0.0.1',
                      capturedAt: new Date(),
                      source: 'chrome',
                      statusCode: event.statusCode,
                      data,
                    });
                  } catch {
                    state.addRequest({
                      id: event.debugbarId,
                      datetime: new Date().toISOString().replace('T', ' ').slice(0, 19),
                      utime: Date.now() / 1000,
                      method: event.method,
                      uri: new URL(event.url).pathname,
                      ip: '127.0.0.1',
                      capturedAt: new Date(),
                      source: 'chrome',
                      statusCode: event.statusCode,
                    });
                  }
                },
              );
              state.setChromeConnected(true);
              log.info(`Chrome monitor started on port ${config.chrome.port}`);
            } catch (err) {
              log.warn(`Chrome auto-connect failed: ${err}`);
            }
          } else {
            log.info(`Chrome not available on port ${config.chrome.port} (CHROME_AUTO_CONNECT=true but Chrome not running)`);
          }
        }
      } else {
        log.warn(`DEBUGBAR_BASE_URL set to "${baseUrl}" but server is not reachable. Use debugbar_connect tool to connect manually.`);
      }
    } catch (err) {
      log.warn(`Auto-connect failed: ${err}`);
    }
  }

  await server.connect(transport);
  log.info('MCP server connected via stdio transport. Ready for requests.');
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
