import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { state } from '../state.js';
import { fetchRequestData } from '../debugbar/client.js';
import { formatLogs } from '../debugbar/formatter.js';

export function registerLogTools(server: McpServer): void {

  server.tool(
    'debugbar_get_logs',
    'Get log messages and debug output from a PHP/Laravel request. Supports filtering by level (debug, info, warning, error, etc.).',
    {
      id: z
        .string()
        .optional()
        .describe('Request ID. Uses most recent if omitted.'),
      level: z
        .enum(['debug', 'info', 'notice', 'warning', 'warn', 'error', 'critical', 'alert', 'emergency'])
        .optional()
        .describe('Filter by log level.'),
      search: z
        .string()
        .optional()
        .describe('Search text within log messages.'),
    },
    async ({ id, level, search }) => {
      if (!state.connected || !state.connectionConfig) {
        return {
          content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
        };
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
          return {
            content: [{ type: 'text', text: `❌ ${err instanceof Error ? err.message : err}` }],
          };
        }
      }

      if (!req.data) {
        return { content: [{ type: 'text', text: '❌ No data available.' }] };
      }

      let data = req.data;

      // Apply search filter on top of the level filter
      if (search && data.messages) {
        const searchLower = search.toLowerCase();
        const filtered = data.messages.messages.filter(m => {
          const body = typeof m.message === 'string'
            ? m.message
            : JSON.stringify(m.message);
          return body.toLowerCase().includes(searchLower);
        });
        data = {
          ...data,
          messages: { ...data.messages, count: filtered.length, messages: filtered },
        };
      }

      return { content: [{ type: 'text', text: formatLogs(data, level) }] };
    },
  );
}
