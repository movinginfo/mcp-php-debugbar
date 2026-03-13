import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { state } from '../state.js';
import { fetchRequestData } from '../debugbar/client.js';
import { formatExceptions } from '../debugbar/formatter.js';

export function registerExceptionTools(server: McpServer): void {

  server.tool(
    'debugbar_get_exceptions',
    'Get all exceptions and errors thrown during a PHP/Laravel request, including full stack traces with file and line numbers.',
    {
      id: z
        .string()
        .optional()
        .describe('Request ID. Uses most recent if omitted.'),
      all_requests: z
        .boolean()
        .optional()
        .describe('Scan all cached requests for exceptions and summarise. Default: false'),
    },
    async ({ id, all_requests = false }) => {
      if (!state.connected || !state.connectionConfig) {
        return {
          content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
        };
      }

      if (all_requests) {
        // Summarise exceptions across all loaded requests
        const lines: string[] = [
          '═'.repeat(60),
          'EXCEPTIONS ACROSS ALL REQUESTS',
          '═'.repeat(60),
          '',
        ];

        const withExceptions = state.requests.filter(
          r => r.data?.exceptions && r.data.exceptions.count > 0,
        );

        if (withExceptions.length === 0) {
          lines.push('✓ No exceptions found in any cached request.');
        } else {
          for (const req of withExceptions) {
            const exc = req.data!.exceptions!;
            lines.push(
              `[${req.id.slice(0, 12)}…] ${req.method} ${req.uri} — ${exc.count} exception(s)`,
            );
            for (const e of exc.exceptions) {
              lines.push(`  • ${e.type}: ${e.message}`);
              lines.push(`    ${e.file}:${e.line}`);
            }
            lines.push('');
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
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

      return { content: [{ type: 'text', text: formatExceptions(req.data) }] };
    },
  );
}
