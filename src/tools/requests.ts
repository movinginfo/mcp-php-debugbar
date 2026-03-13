import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { state } from '../state.js';
import { fetchRequestList, fetchRequestData, makeTrackedRequest } from '../debugbar/client.js';
import {
  formatRequestList,
  formatRequestSummary,
  formatFullReport,
} from '../debugbar/formatter.js';

export function registerRequestTools(server: McpServer): void {

  // ─── debugbar_list_requests ─────────────────────────────────────────

  server.tool(
    'debugbar_list_requests',
    'List all captured PHP/Laravel debugbar requests, showing method, URI, timing, query count, and log count.',
    {
      max: z
        .number()
        .optional()
        .describe('Max number of requests to show. Default: 25'),
      refresh: z
        .boolean()
        .optional()
        .describe('Fetch fresh data from the server before listing. Default: false'),
    },
    async ({ max = 25, refresh = false }) => {
      if (!state.connected || !state.connectionConfig) {
        return {
          content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
        };
      }

      if (refresh) {
        try {
          const fresh = await fetchRequestList(state.connectionConfig, max, 0);
          state.addRequests(fresh);
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Failed to refresh: ${err instanceof Error ? err.message : err}`,
              },
            ],
          };
        }
      }

      const requests = state.requests.slice(0, max);
      return { content: [{ type: 'text', text: formatRequestList(requests) }] };
    },
  );

  // ─── debugbar_get_request ───────────────────────────────────────────

  server.tool(
    'debugbar_get_request',
    'Get detailed debugging information for a specific request by its ID. Shows timing, memory, route, queries summary, and more.',
    {
      id: z
        .string()
        .optional()
        .describe('Request ID. If omitted, uses the most recent captured request.'),
      load_data: z
        .boolean()
        .optional()
        .describe('Fetch full data from server if not already loaded. Default: true'),
      full_report: z
        .boolean()
        .optional()
        .describe('Include full report with queries, logs, timeline inline. Default: false'),
    },
    async ({ id, load_data = true, full_report = false }) => {
      if (!state.connected || !state.connectionConfig) {
        return {
          content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
        };
      }

      let req = id ? state.getRequest(id) : state.getLatestRequest();
      if (!req) {
        const msg = id
          ? `❌ Request ID "${id}" not found. Use debugbar_list_requests to see available IDs.`
          : '❌ No requests captured yet. Browse your PHP app or use debugbar_fetch_url.';
        return { content: [{ type: 'text', text: msg }] };
      }

      if (!req.data && load_data) {
        try {
          const data = await fetchRequestData(state.connectionConfig, req.id);
          req = { ...req, data };
          state.addRequest(req);
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Could not load data for request ${req.id}: ${err instanceof Error ? err.message : err}`,
              },
            ],
          };
        }
      }

      const text = full_report ? formatFullReport(req) : formatRequestSummary(req);
      return { content: [{ type: 'text', text }] };
    },
  );

  // ─── debugbar_fetch_url ─────────────────────────────────────────────

  server.tool(
    'debugbar_fetch_url',
    'Make an HTTP request to the connected PHP server, capture the debugbar data from the response, and store it. Great for testing specific endpoints.',
    {
      path: z
        .string()
        .describe('URL path to request, e.g. /api/users or /admin/dashboard'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
        .optional()
        .describe('HTTP method. Default: GET'),
      headers: z
        .record(z.string())
        .optional()
        .describe('Additional request headers as key-value pairs'),
      body: z
        .string()
        .optional()
        .describe('Request body (for POST/PUT/PATCH). JSON string.'),
    },
    async ({ path, method = 'GET', headers = {}, body }) => {
      if (!state.connected || !state.connectionConfig) {
        return {
          content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
        };
      }

      const cfg = state.connectionConfig;
      let parsedBody: unknown;
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = body;
        }
      }

      try {
        const result = await makeTrackedRequest(cfg, path, method, headers, parsedBody);

        if (!result.debugbarId) {
          return {
            content: [
              {
                type: 'text',
                text: [
                  `HTTP ${result.statusCode} ${method} ${cfg.baseUrl}${path}`,
                  '',
                  '⚠️  No debugbar ID found in response headers.',
                  'Make sure PHP DebugBar / Laravel Debugbar is enabled for this request.',
                  '',
                  'For Laravel: check APP_DEBUG=true and DEBUGBAR_ENABLED=true in .env',
                  'For PHP DebugBar: ensure sendDataInHeaders() or renderHead() is called.',
                ].join('\n'),
              },
            ],
          };
        }

        const req = {
          id: result.debugbarId,
          datetime: new Date().toISOString().replace('T', ' ').slice(0, 19),
          utime: Date.now() / 1000,
          method,
          uri: path,
          ip: '127.0.0.1',
          capturedAt: new Date(),
          source: 'manual' as const,
          statusCode: result.statusCode,
          data: result.data,
        };
        state.addRequest(req);

        const lines = [
          `✅ ${method} ${cfg.baseUrl}${path} → HTTP ${result.statusCode}`,
          `   Debugbar ID: ${result.debugbarId}`,
        ];

        if (result.data) {
          const d = result.data;
          if (d.time) lines.push(`   Duration   : ${d.time.duration_str}`);
          if (d.memory) lines.push(`   Memory     : ${d.memory.peak_usage_str}`);
          if (d.pdo) lines.push(`   SQL queries: ${d.pdo.nb_statements} (${d.pdo.accumulated_duration_str})`);
          if (d.exceptions?.count) lines.push(`   ⚠️  Exceptions: ${d.exceptions.count}`);
          if (d.messages?.count) lines.push(`   Log messages: ${d.messages.count}`);
        }

        lines.push('');
        lines.push(`Use debugbar_get_request with id="${result.debugbarId}" for full details.`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Request failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  // ─── debugbar_refresh ───────────────────────────────────────────────

  server.tool(
    'debugbar_refresh_requests',
    'Fetch the latest requests from the PHP server\'s debugbar storage and update the local cache.',
    {
      max: z.number().optional().describe('Max requests to fetch. Default: 25'),
    },
    async ({ max = 25 }) => {
      if (!state.connected || !state.connectionConfig) {
        return {
          content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
        };
      }

      try {
        const before = state.requests.length;
        const fresh = await fetchRequestList(state.connectionConfig, max, 0);
        state.addRequests(fresh);
        const after = state.requests.length;
        const newCount = after - before;

        return {
          content: [
            {
              type: 'text',
              text: `✅ Refreshed: ${fresh.length} requests fetched, ${newCount} new.\nTotal in cache: ${after}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  // ─── debugbar_clear ─────────────────────────────────────────────────

  server.tool(
    'debugbar_clear',
    'Clear all locally cached debugbar requests from memory.',
    {},
    async () => {
      state.clearRequests();
      return {
        content: [{ type: 'text', text: '✅ Cleared all cached debugbar requests.' }],
      };
    },
  );
}
