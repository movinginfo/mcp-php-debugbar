/**
 * Cursor IDE — specific MCP tools.
 *
 * These tools close the loop between:
 *   Cursor editor ←→ PHP DebugBar data ←→ AI assistant
 *
 * Key workflows:
 *   1. debugbar_open_preview     — gives exact commands to open a browser preview
 *   2. debugbar_start_polling    — poll for new requests (no CDP needed)
 *   3. debugbar_stop_polling     — stop polling
 *   4. debugbar_auto_analyze     — analyze latest request and return fix suggestions
 *   5. debugbar_watch_and_debug  — start monitoring + auto-analyze each new request
 *   6. debugbar_suggest_fixes    — parse debug data and produce AI-ready fix list
 *   7. debugbar_webhook_start    — start webhook receiver for injected JS mode
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { state } from '../state.js';
import { analyzeRequest, analyzeAll, formatAnalysis } from '../analyzer/index.js';
import {
  PREVIEW_MODES,
  getLaunchCommands,
  startPolling,
  startWebhookReceiver,
  getInjectableScript,
  getPhpInjectSnippet,
  type PollingManager,
  type WebhookServer,
} from '../cursor/preview.js';
import { fetchRequestData, fetchRequestList } from '../debugbar/client.js';
import { log } from '../logger.js';

// ─── Module-level polling/webhook instances ───────────────────────────────
let pollingManager: PollingManager | null = null;
let webhookServer: WebhookServer | null = null;

// ─── Tool registrations ───────────────────────────────────────────────────

export function registerCursorTools(server: McpServer): void {

  // ── debugbar_open_preview ────────────────────────────────────────────

  server.tool(
    'debugbar_open_preview',
    'Get the exact commands and steps to open a browser preview with PHP DebugBar integration in Cursor IDE or Chrome. Shows how to enable automatic debug data capture.',
    {
      url: z.string().optional()
        .describe('URL to open. Default: uses connected server URL'),
      mode: z
        .enum(['cursor-simple-browser', 'chrome-cdp', 'edge-cdp', 'all'])
        .optional()
        .describe('Preview mode. Default: all (shows all options)'),
      cdp_port: z.number().optional()
        .describe('Chrome DevTools Protocol port. Default: 9222'),
    },
    async ({ url, mode = 'all', cdp_port = 9222 }) => {
      const baseUrl = url ?? state.connectionConfig?.baseUrl ?? 'http://localhost:8000';
      const cmds = getLaunchCommands(baseUrl, cdp_port);

      const lines: string[] = [
        '═'.repeat(64),
        'CURSOR + PHP DEBUGBAR — PREVIEW SETUP',
        '═'.repeat(64),
        '',
        `PHP server URL: ${baseUrl}`,
        `CDP port      : ${cdp_port}`,
        '',
      ];

      // ── Option A: Cursor Simple Browser ─────────────────────────────
      if (mode === 'all' || mode === 'cursor-simple-browser') {
        lines.push('─'.repeat(64));
        lines.push('OPTION A — Cursor Simple Browser (built-in, polling mode)');
        lines.push('─'.repeat(64));
        lines.push('');
        lines.push('Step 1: Open Simple Browser in Cursor:');
        lines.push('  • Press Ctrl+Shift+P (Cmd+Shift+P on Mac)');
        lines.push('  • Type: "Simple Browser: Show"');
        lines.push(`  • Enter URL: ${baseUrl}`);
        lines.push('  • Or open from the Ports panel in Cursor');
        lines.push('');
        lines.push('Step 2: Start polling to capture requests:');
        lines.push('  debugbar_start_polling(interval_ms=2000)');
        lines.push('');
        lines.push('Step 3: Browse the site — requests captured every 2 seconds.');
        lines.push('');
        lines.push('✓ Pros: No external browser needed, DebugBar visible in webview');
        lines.push('✗ Cons: 2s polling delay, no automatic AJAX capture');
        lines.push('');
      }

      // ── Option B: Chrome with CDP ─────────────────────────────────────
      if (mode === 'all' || mode === 'chrome-cdp') {
        lines.push('─'.repeat(64));
        lines.push('OPTION B — Chrome with DevTools Protocol (RECOMMENDED)');
        lines.push('─'.repeat(64));
        lines.push('');
        lines.push('Step 1: Launch Chrome with remote debugging:');
        lines.push('');
        lines.push('  PowerShell / Windows:');
        lines.push(`    ${cmds.windows}`);
        lines.push('');
        lines.push('  macOS:');
        lines.push(`    ${cmds.macos}`);
        lines.push('');
        lines.push('  Linux:');
        lines.push(`    ${cmds.linux}`);
        lines.push('');
        lines.push('Step 2: Connect MCP server to Chrome:');
        lines.push(`  debugbar_connect(base_url="${baseUrl}", chrome_port=${cdp_port})`);
        lines.push('');
        lines.push('Step 3: Browse the site — EVERY request is captured instantly!');
        lines.push('');
        lines.push('✓ Pros: Zero-delay, captures all requests including AJAX/API');
        lines.push('✗ Cons: Chrome must be started with the debug flag');
        lines.push('');
      }

      // ── Option C: Edge CDP ─────────────────────────────────────────
      if (mode === 'all' || mode === 'edge-cdp') {
        lines.push('─'.repeat(64));
        lines.push('OPTION C — Microsoft Edge (pre-installed on Windows)');
        lines.push('─'.repeat(64));
        lines.push('');
        lines.push('  PowerShell:');
        lines.push(`    Start-Process "msedge.exe" -ArgumentList "--remote-debugging-port=${cdp_port} --new-window ${baseUrl}"`);
        lines.push('');
        lines.push(`  Then: debugbar_connect(base_url="${baseUrl}", chrome_port=${cdp_port})`);
        lines.push('');
      }

      // ── Current status ────────────────────────────────────────────────
      lines.push('─'.repeat(64));
      lines.push('CURRENT STATUS');
      lines.push('─'.repeat(64));
      lines.push(state.toSummary());

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // ── debugbar_start_polling ────────────────────────────────────────────

  server.tool(
    'debugbar_start_polling',
    'Start polling the PHP DebugBar open handler for new requests. Use this when Chrome CDP is not available (e.g. Cursor Simple Browser mode). Every new request is captured automatically.',
    {
      interval_ms: z.number().optional()
        .describe('Polling interval in milliseconds. Default: 2000 (2 seconds)'),
      auto_analyze: z.boolean().optional()
        .describe('Automatically analyze each new request and log issues. Default: true'),
    },
    async ({ interval_ms = 2000, auto_analyze = true }) => {
      if (!state.connected || !state.connectionConfig) {
        return { content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }] };
      }

      if (pollingManager?.isRunning) {
        pollingManager.stop();
        pollingManager = null;
      }

      try {
        pollingManager = startPolling(interval_ms, (req) => {
          if (auto_analyze && req.data) {
            const result = analyzeRequest(req);
            if (result && result.issues.length > 0) {
              log.info(`Auto-analysis [${req.uri}]: score=${result.score}, issues=${result.issues.length}`);
              result.issues.forEach(i => log.warn(`  [${i.category}] ${i.title}`));
            }
          }
        });

        return {
          content: [{
            type: 'text',
            text: [
              `✅ Polling started (every ${interval_ms}ms)`,
              `Auto-analyze: ${auto_analyze ? 'enabled' : 'disabled'}`,
              '',
              'Now browse your PHP app in Cursor Simple Browser or any browser.',
              'New requests will be captured automatically.',
              '',
              'Use debugbar_list_requests() to see captured requests.',
              'Use debugbar_stop_polling() to stop.',
            ].join('\n'),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ Failed to start polling: ${err instanceof Error ? err.message : err}` }],
        };
      }
    },
  );

  // ── debugbar_stop_polling ─────────────────────────────────────────────

  server.tool(
    'debugbar_stop_polling',
    'Stop the request polling loop.',
    {},
    async () => {
      if (!pollingManager?.isRunning) {
        return { content: [{ type: 'text', text: 'ℹ️ Polling is not running.' }] };
      }
      const count = pollingManager.capturedCount;
      pollingManager.stop();
      pollingManager = null;
      return {
        content: [{
          type: 'text',
          text: `✅ Polling stopped. Captured ${count} new request(s) during this session.`,
        }],
      };
    },
  );

  // ── debugbar_auto_analyze ─────────────────────────────────────────────

  server.tool(
    'debugbar_auto_analyze',
    'Deeply analyze a captured request with the smart issue detection engine. Returns a health score, detected issues (N+1 queries, slow queries, exceptions, memory, performance), and concrete fix suggestions for each issue.',
    {
      id: z.string().optional()
        .describe('Request ID to analyze. Uses most recent request if omitted.'),
      slow_query_ms: z.number().optional()
        .describe('Threshold for slow query detection in ms. Default: 200'),
      slow_request_ms: z.number().optional()
        .describe('Threshold for slow request detection in ms. Default: 500'),
    },
    async ({ id, slow_query_ms, slow_request_ms }) => {
      if (!state.connected || !state.connectionConfig) {
        return { content: [{ type: 'text', text: '❌ Not connected.' }] };
      }

      let req = id ? state.getRequest(id) : state.getLatestRequest();
      if (!req) {
        return { content: [{ type: 'text', text: '❌ No requests found. Browse your app or use debugbar_fetch_url.' }] };
      }

      if (!req.data) {
        try {
          const data = await fetchRequestData(state.connectionConfig, req.id);
          req = { ...req, data };
          state.addRequest(req);
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ Failed to load data: ${err}` }] };
        }
      }

      const result = analyzeRequest(req, {
        slowQueryMs: slow_query_ms,
        slowRequestMs: slow_request_ms,
      });

      if (!result) {
        return { content: [{ type: 'text', text: '❌ No data available for analysis.' }] };
      }

      return { content: [{ type: 'text', text: formatAnalysis(result) }] };
    },
  );

  // ── debugbar_analyze_all ──────────────────────────────────────────────

  server.tool(
    'debugbar_analyze_all',
    'Run auto-analysis across ALL cached requests and show a prioritized list of issues, ranked by severity. Perfect for identifying the most critical problems across your entire app.',
    {
      limit: z.number().optional().describe('Max requests to analyze. Default: 20'),
      min_severity: z.enum(['critical', 'warning', 'info']).optional()
        .describe('Only show issues at or above this severity. Default: warning'),
    },
    async ({ limit = 20, min_severity = 'warning' }) => {
      if (!state.connected) {
        return { content: [{ type: 'text', text: '❌ Not connected.' }] };
      }

      // Load data for requests that don't have it yet
      if (state.connectionConfig) {
        const toLoad = state.requests
          .filter(r => !r.data)
          .slice(0, limit);

        await Promise.allSettled(toLoad.map(async (req) => {
          try {
            const data = await fetchRequestData(state.connectionConfig!, req.id);
            state.addRequest({ ...req, data });
          } catch { /* skip */ }
        }));
      }

      const results = analyzeAll(state.requests.slice(0, limit));
      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No requests with data found. Browse your app first.' }] };
      }

      const HR = '═'.repeat(70);
      const lines: string[] = [
        HR,
        `FULL APP ANALYSIS — ${results.length} request(s)`,
        HR,
        '',
      ];

      const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      const minLevel = severityOrder[min_severity] ?? 1;

      // Issues across all requests, flattened and sorted
      const allIssues = results.flatMap(r =>
        r.issues
          .filter(i => (severityOrder[i.severity] ?? 99) <= minLevel)
          .map(i => ({ ...i, requestUri: r.uri, requestId: r.requestId, score: r.score }))
      ).sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

      if (allIssues.length === 0) {
        lines.push(`✅ No ${min_severity}+ issues found across ${results.length} requests.`);
      } else {
        lines.push(`Found ${allIssues.length} issue(s) (severity ≥ ${min_severity}):`);
        lines.push('');

        allIssues.forEach((issue, i) => {
          const icon = issue.severity === 'critical' ? '🔴' : '🟡';
          lines.push(`${i + 1}. ${icon} [${issue.category}] ${issue.title}`);
          lines.push(`   Request: ${issue.requestUri}`);
          if (issue.file) lines.push(`   File   : ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
          lines.push(`   Fix    : ${issue.suggestion.split('\n')[0]}`);
          lines.push('');
        });
      }

      // Per-request scores
      lines.push('─'.repeat(70));
      lines.push('HEALTH SCORES PER REQUEST:');
      lines.push('');
      results.forEach(r => {
        const bar = '█'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
        const exc = r.stats.exceptions ? ` ⚠${r.stats.exceptions}exc` : '';
        const n1  = r.stats.duplicateQueries ? ` N+1` : '';
        lines.push(`  ${r.score.toString().padStart(3)}/100 [${bar}] ${r.method} ${r.uri}${exc}${n1}`);
      });

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // ── debugbar_suggest_fixes ────────────────────────────────────────────

  server.tool(
    'debugbar_suggest_fixes',
    'Get a prioritized, actionable list of code fixes for a request based on its debug data. Returns specific PHP/Laravel code suggestions the AI can apply directly.',
    {
      id: z.string().optional()
        .describe('Request ID. Uses most recent if omitted.'),
      include_code: z.boolean().optional()
        .describe('Include full code examples in suggestions. Default: true'),
    },
    async ({ id, include_code = true }) => {
      if (!state.connected || !state.connectionConfig) {
        return { content: [{ type: 'text', text: '❌ Not connected.' }] };
      }

      let req = id ? state.getRequest(id) : state.getLatestRequest();
      if (!req) {
        return { content: [{ type: 'text', text: '❌ No requests found.' }] };
      }

      if (!req.data) {
        try {
          const data = await fetchRequestData(state.connectionConfig, req.id);
          req = { ...req, data };
          state.addRequest(req);
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ ${err}` }] };
        }
      }

      const result = analyzeRequest(req);
      if (!result || result.issues.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `✅ No issues detected for ${req.method} ${req.uri}\nScore: ${result?.score ?? 'N/A'}/100`,
          }],
        };
      }

      const lines: string[] = [
        '═'.repeat(64),
        `FIX SUGGESTIONS — ${req.method} ${req.uri} (score: ${result.score}/100)`,
        '═'.repeat(64),
        '',
        `${result.issues.length} issue(s) found, ordered by priority:`,
        '',
      ];

      result.issues.forEach((issue, idx) => {
        const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️';
        lines.push(`${'─'.repeat(60)}`);
        lines.push(`${idx + 1}. ${icon} ${issue.title}`);
        lines.push(`   Category : ${issue.category}`);
        lines.push(`   Severity : ${issue.severity}`);
        if (issue.file) {
          lines.push(`   Location : ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
        }
        lines.push('');

        if (include_code) {
          lines.push('   SUGGESTED FIX:');
          issue.suggestion.split('\n').forEach(l => lines.push(`   ${l}`));
        } else {
          lines.push(`   ${issue.suggestion.split('\n')[0]}`);
        }
        lines.push('');
      });

      lines.push('─'.repeat(64));
      lines.push('TO APPLY: Tell the AI "Apply fix #1" or "Fix all critical issues"');

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // ── debugbar_watch_and_debug ──────────────────────────────────────────

  server.tool(
    'debugbar_watch_and_debug',
    'Start continuous monitoring: poll for new requests AND automatically analyze each one. Shows a live debug dashboard in the MCP output. Best used with Cursor Simple Browser.',
    {
      interval_ms: z.number().optional()
        .describe('Poll interval in ms. Default: 3000'),
      alert_on: z.enum(['all', 'critical', 'warning']).optional()
        .describe('When to show analysis results. Default: warning'),
      max_captures: z.number().optional()
        .describe('Stop after capturing this many new requests. Default: unlimited (0)'),
    },
    async ({ interval_ms = 3000, alert_on = 'warning', max_captures = 0 }) => {
      if (!state.connected || !state.connectionConfig) {
        return { content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }] };
      }

      if (pollingManager?.isRunning) {
        pollingManager.stop();
        pollingManager = null;
      }

      const severityOrder: Record<string, number> = { critical: 0, warning: 1, all: 2 };
      const minLevel = severityOrder[alert_on] ?? 1;
      const alerts: string[] = [];

      pollingManager = startPolling(interval_ms, (req) => {
        if (!req.data) return;

        const result = analyzeRequest(req);
        if (!result) return;

        const maxSeverityLevel = result.issues.length === 0 ? 99 :
          Math.min(...result.issues.map(i => severityOrder[i.severity] ?? 99));

        if (maxSeverityLevel <= minLevel || result.issues.length === 0) {
          const summary = result.issues.length === 0
            ? `✅ ${req.method} ${req.uri} — OK (${req.data.time?.duration_str ?? '?'})`
            : `${result.summary}`;
          alerts.push(summary);
        }

        if (max_captures > 0 && pollingManager && pollingManager.capturedCount >= max_captures) {
          pollingManager.stop();
          pollingManager = null;
        }
      });

      return {
        content: [{
          type: 'text',
          text: [
            `✅ Watch & Debug started`,
            `   Poll interval: ${interval_ms}ms`,
            `   Alert level  : ${alert_on}`,
            max_captures ? `   Stop after  : ${max_captures} captures` : '',
            '',
            'Browse your PHP app. Analysis runs automatically on each new request.',
            '',
            'Check debugbar_list_requests() or debugbar_auto_analyze() for results.',
            'Stop with: debugbar_stop_polling()',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  // ── debugbar_webhook_start ────────────────────────────────────────────

  server.tool(
    'debugbar_webhook_start',
    'Start a local webhook server that receives PHP DebugBar IDs sent from an injected JavaScript snippet. Returns the JS snippet and PHP snippet to add to your project for zero-configuration capture.',
    {
      port: z.number().optional()
        .describe('Webhook server port. Default: 9223'),
    },
    async ({ port = 9223 }) => {
      if (webhookServer) {
        await webhookServer.stop();
        webhookServer = null;
      }

      if (!state.connected || !state.connectionConfig) {
        return { content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }] };
      }

      const cfg = state.connectionConfig;

      try {
        webhookServer = await startWebhookReceiver(port, async (id, url) => {
          try {
            const data = await fetchRequestData(cfg, id);
            state.addRequest({
              id,
              datetime: new Date().toISOString().replace('T', ' ').slice(0, 19),
              utime: Date.now() / 1000,
              method: 'GET',
              uri: new URL(url).pathname,
              ip: '127.0.0.1',
              capturedAt: new Date(),
              source: 'manual',
              data,
            });
            log.info(`Webhook captured: ${url}`);
          } catch (err) {
            log.warn(`Webhook fetch failed: ${err}`);
          }
        });

        return {
          content: [{
            type: 'text',
            text: [
              `✅ Webhook receiver started on port ${port}`,
              '',
              '─'.repeat(60),
              'ADD TO YOUR PHP LAYOUT (before </body>):',
              '─'.repeat(60),
              getPhpInjectSnippet(port),
              '',
              '─'.repeat(60),
              'OR ADD JAVASCRIPT SNIPPET (if PHP is not modifiable):',
              '─'.repeat(60),
              getInjectableScript(port),
              '',
              'Now every page load will automatically push debug data to the MCP server.',
            ].join('\n'),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `❌ Failed to start webhook: ${err instanceof Error ? err.message : err}`,
          }],
        };
      }
    },
  );

  // ── debugbar_preview_modes ────────────────────────────────────────────

  server.tool(
    'debugbar_preview_modes',
    'Show all available preview modes for Cursor + PHP DebugBar integration, with pros/cons for each approach.',
    {},
    async () => {
      const lines: string[] = ['═'.repeat(64), 'AVAILABLE PREVIEW MODES', '═'.repeat(64), ''];

      for (const [key, mode] of Object.entries(PREVIEW_MODES)) {
        lines.push(`${mode.name} [${key}]`);
        lines.push(`  ${mode.description}`);
        lines.push('  Setup:');
        mode.setupSteps.forEach(s => lines.push(`    ${s}`));
        lines.push('  ✓ Pros: ' + mode.proAndCons.pros.join(', '));
        lines.push('  ✗ Cons: ' + mode.proAndCons.cons.join(', '));
        lines.push('');
      }

      lines.push('Use debugbar_open_preview(mode="...") for detailed setup instructions.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
