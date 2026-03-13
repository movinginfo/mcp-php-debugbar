import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { state } from '../state.js';
import { config as appConfig } from '../config.js';
import { detectProjectType, fetchRequestList, probeServer } from '../debugbar/client.js';
import { startChromeMonitor, pingChrome, getChromeVersion, listChromeTabs, } from '../chrome/browser.js';
import { fetchRequestData } from '../debugbar/client.js';
import { log } from '../logger.js';
let chromeMonitorInstance = null;
// ─── debugbar_connect ─────────────────────────────────────────────────────
export function registerConnectionTools(server) {
    server.tool('debugbar_connect', 'Connect to a running PHP/Laravel development server and optionally start monitoring Chrome browser for automatic debugbar data capture.', {
        base_url: z
            .string()
            .describe('Base URL of the PHP/Laravel dev server, e.g. http://localhost:8000'),
        open_handler_path: z
            .string()
            .optional()
            .describe('Path to debugbar open handler. Default: /_debugbar/open (Laravel) or /debugbar/open.php (vanilla PHP)'),
        type: z
            .enum(['laravel', 'php', 'auto'])
            .optional()
            .describe('Project type. Default: auto-detect'),
        chrome_port: z
            .number()
            .optional()
            .describe('Chrome remote debugging port. Start Chrome with: --remote-debugging-port=9222. Enables automatic request capture.'),
        chrome_host: z
            .string()
            .optional()
            .describe('Chrome remote debugging host. Default: localhost'),
        load_recent: z
            .boolean()
            .optional()
            .describe('Fetch recent requests from the server after connecting. Default: true'),
    }, async ({ base_url, open_handler_path, type, chrome_port, chrome_host, load_recent = true }) => {
        // Normalise URL
        const baseUrl = base_url.replace(/\/$/, '');
        // Probe server connectivity
        const reachable = await probeServer(baseUrl, 8000);
        if (!reachable) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Cannot reach server at ${baseUrl}.\nMake sure your PHP/Laravel dev server is running (e.g. php artisan serve).`,
                    },
                ],
            };
        }
        // Detect project type — check PROJECT_ROOT for artisan first (fast, no HTTP)
        let projectType = type ?? appConfig.debugbar.type;
        const projectRoot = appConfig.projectRoot;
        if (projectType === 'auto') {
            if (projectRoot && fs.existsSync(path.join(projectRoot, 'artisan'))) {
                projectType = 'laravel';
            }
            else {
                projectType = await detectProjectType(baseUrl, 10000);
            }
        }
        // Determine open handler path
        const handlerPath = open_handler_path ??
            appConfig.debugbar.openHandlerPath ??
            (projectType === 'laravel' ? '/_debugbar/open' : '/debugbar/open');
        const cfg = {
            baseUrl,
            openHandlerPath: handlerPath,
            type: projectType,
            timeout: 10000,
            chromePort: chrome_port ?? appConfig.chrome.port,
            chromeHost: chrome_host ?? appConfig.chrome.host,
        };
        state.connect(cfg);
        const laravelDetected = projectRoot && fs.existsSync(path.join(projectRoot, 'artisan'));
        const lines = [
            `✅ Connected to ${baseUrl}`,
            `   Type       : ${projectType}${laravelDetected ? ' (auto-detected via artisan)' : ''}`,
            `   Handler    : ${handlerPath}`,
            `   Project    : ${projectRoot || '(not set — add PROJECT_ROOT to .env for source-file features)'}`,
        ];
        // Load recent requests
        if (load_recent) {
            try {
                const requests = await fetchRequestList(cfg, 20, 0);
                state.addRequests(requests);
                lines.push(`   Requests   : ${requests.length} loaded from server`);
            }
            catch (err) {
                lines.push(`   Requests   : Could not load (${err instanceof Error ? err.message : err})`);
                lines.push(`   Note       : Make sure debugbar.storage.open is enabled in config/debugbar.php`);
            }
        }
        // Start Chrome monitor if port provided
        const cPort = chrome_port ?? (appConfig.chrome.autoConnect ? appConfig.chrome.port : undefined);
        if (cPort) {
            const cHost = chrome_host ?? appConfig.chrome.host;
            try {
                if (chromeMonitorInstance) {
                    await chromeMonitorInstance.stop();
                    chromeMonitorInstance = null;
                }
                chromeMonitorInstance = await startChromeMonitor(cHost, cPort, baseUrl, async (event) => {
                    // Auto-fetch debugbar data when Chrome detects a new request
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
                        log.info(`Auto-captured request: ${event.method} ${event.url}`);
                    }
                    catch (err) {
                        log.warn(`Failed to auto-fetch debugbar data: ${err}`);
                        // Still add the request metadata even if data fetch fails
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
                });
                state.setChromeConnected(true);
                const version = await getChromeVersion(cHost, cPort);
                lines.push(`   Chrome     : ✓ Monitoring (${version})`);
            }
            catch (err) {
                lines.push(`   Chrome     : ✗ Failed — ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        lines.push('');
        lines.push('Ready! Use debugbar_list_requests to see captured requests.');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    });
    // ─── debugbar_disconnect ──────────────────────────────────────────────
    server.tool('debugbar_disconnect', 'Disconnect from the PHP server and stop Chrome monitoring.', {}, async () => {
        if (chromeMonitorInstance) {
            await chromeMonitorInstance.stop();
            chromeMonitorInstance = null;
        }
        state.disconnect();
        return {
            content: [{ type: 'text', text: '✅ Disconnected from PHP server and stopped Chrome monitoring.' }],
        };
    });
    // ─── debugbar_status ─────────────────────────────────────────────────
    server.tool('debugbar_status', 'Show current connection status, Chrome monitoring state, and number of captured requests.', {}, async () => {
        return { content: [{ type: 'text', text: state.toSummary() }] };
    });
    // ─── debugbar_chrome_tabs ─────────────────────────────────────────────
    server.tool('debugbar_chrome_tabs', 'List open tabs in Chrome browser (requires Chrome remote debugging port).', {
        chrome_port: z.number().optional().describe('Chrome debugging port. Default: 9222'),
        chrome_host: z.string().optional().describe('Chrome host. Default: localhost'),
    }, async ({ chrome_port, chrome_host }) => {
        const port = chrome_port ?? appConfig.chrome.port;
        const host = chrome_host ?? appConfig.chrome.host;
        const reachable = await pingChrome(host, port);
        if (!reachable) {
            return {
                content: [
                    {
                        type: 'text',
                        text: [
                            `❌ Chrome not reachable at ${host}:${port}`,
                            '',
                            'To enable Chrome remote debugging:',
                            '  Windows: chrome.exe --remote-debugging-port=9222',
                            '  macOS  : /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222',
                            '  Linux  : google-chrome --remote-debugging-port=9222',
                            '',
                            'Or for Cursor built-in browser, check the Cursor dev tools port setting.',
                        ].join('\n'),
                    },
                ],
            };
        }
        const tabs = await listChromeTabs(host, port);
        const version = await getChromeVersion(host, port);
        const lines = [
            `Chrome: ${version}`,
            `Open tabs (${tabs.length}):`,
            '',
            ...tabs.map((t, i) => `${i + 1}. [${t.type}] ${t.title}\n   ${t.url}`),
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    });
    // ─── debugbar_start_chrome ────────────────────────────────────────────
    server.tool('debugbar_start_chrome_monitor', 'Start or restart Chrome DevTools Protocol monitoring for automatic debugbar request capture.', {
        chrome_port: z.number().optional().describe('Chrome debugging port. Default: 9222'),
        chrome_host: z.string().optional().describe('Chrome host. Default: localhost'),
    }, async ({ chrome_port, chrome_host }) => {
        if (!state.connected || !state.connectionConfig) {
            return {
                content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
            };
        }
        const cfg = state.connectionConfig;
        const port = chrome_port ?? cfg.chromePort ?? appConfig.chrome.port;
        const host = chrome_host ?? cfg.chromeHost ?? appConfig.chrome.host;
        if (chromeMonitorInstance) {
            await chromeMonitorInstance.stop();
            chromeMonitorInstance = null;
            state.setChromeConnected(false);
        }
        try {
            chromeMonitorInstance = await startChromeMonitor(host, port, cfg.baseUrl, async (event) => {
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
                }
                catch {
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
            });
            state.setChromeConnected(true);
            const version = await getChromeVersion(host, port);
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ Chrome monitor started\nBrowser: ${version}\nMonitoring: ${cfg.baseUrl}\n\nAll requests to your PHP app will now be automatically captured.`,
                    },
                ],
            };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Failed to start Chrome monitor: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
            };
        }
    });
}
export { chromeMonitorInstance };
//# sourceMappingURL=connection.js.map