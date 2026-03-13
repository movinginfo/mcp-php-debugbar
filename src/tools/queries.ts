import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { state } from '../state.js';
import { fetchRequestData } from '../debugbar/client.js';
import { formatQueries, formatDuplicateQueries } from '../debugbar/formatter.js';

export function registerQueryTools(server: McpServer): void {

  // ─── debugbar_get_queries ─────────────────────────────────────────

  server.tool(
    'debugbar_get_queries',
    'Get all SQL queries executed during a PHP/Laravel request. Shows query text, bindings, duration, row count, and slow queries warning.',
    {
      id: z
        .string()
        .optional()
        .describe('Request ID. Uses most recent request if omitted.'),
      limit: z
        .number()
        .optional()
        .describe('Max queries to show. Default: 50'),
      slow_only: z
        .boolean()
        .optional()
        .describe('Show only slow queries (>200ms). Default: false'),
      connection: z
        .string()
        .optional()
        .describe('Filter by database connection name.'),
      search: z
        .string()
        .optional()
        .describe('Filter queries containing this text (case-insensitive).'),
    },
    async ({ id, limit = 50, slow_only = false, connection, search }) => {
      if (!state.connected || !state.connectionConfig) {
        return {
          content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
        };
      }

      let req = id ? state.getRequest(id) : state.getLatestRequest();
      if (!req) {
        return {
          content: [{ type: 'text', text: '❌ No requests found. Use debugbar_fetch_url or browse your app.' }],
        };
      }

      if (!req.data) {
        try {
          const data = await fetchRequestData(state.connectionConfig, req.id);
          req = { ...req, data };
          state.addRequest(req);
        } catch (err) {
          return {
            content: [
              { type: 'text', text: `❌ Could not load data: ${err instanceof Error ? err.message : err}` },
            ],
          };
        }
      }

      if (!req.data) {
        return { content: [{ type: 'text', text: '❌ No data available for this request.' }] };
      }

      // Apply filters
      let data = req.data;
      if ((slow_only || connection || search) && data.pdo) {
        let stmts = [...data.pdo.statements];

        if (slow_only) {
          stmts = stmts.filter(s => s.duration > 200);
        }
        if (connection) {
          stmts = stmts.filter(s =>
            s.connection?.toLowerCase().includes(connection.toLowerCase()),
          );
        }
        if (search) {
          stmts = stmts.filter(s =>
            s.sql.toLowerCase().includes(search.toLowerCase()),
          );
        }

        data = {
          ...data,
          pdo: {
            ...data.pdo,
            nb_statements: stmts.length,
            statements: stmts,
          },
        };
      }

      return { content: [{ type: 'text', text: formatQueries(data, limit) }] };
    },
  );

  // ─── debugbar_get_duplicate_queries ───────────────────────────────

  server.tool(
    'debugbar_get_duplicate_queries',
    'Detect duplicate/redundant SQL queries in a request — a common performance issue in Laravel (N+1 problem).',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
    },
    async ({ id }) => {
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

      return { content: [{ type: 'text', text: formatDuplicateQueries(req.data) }] };
    },
  );

  // ─── debugbar_compare_queries ─────────────────────────────────────

  server.tool(
    'debugbar_compare_queries',
    'Compare SQL query counts and total time between two captured requests to measure optimization impact.',
    {
      id1: z.string().describe('First request ID (e.g. before optimization)'),
      id2: z.string().describe('Second request ID (e.g. after optimization)'),
    },
    async ({ id1, id2 }) => {
      if (!state.connected || !state.connectionConfig) {
        return {
          content: [{ type: 'text', text: '❌ Not connected.' }],
        };
      }

      const cfg = state.connectionConfig;

      let req1 = state.getRequest(id1);
      let req2 = state.getRequest(id2);

      if (!req1 || !req2) {
        return {
          content: [{ type: 'text', text: `❌ One or both request IDs not found.` }],
        };
      }

      // Load data if needed
      for (const [req, setter] of [[req1, (r: typeof req1) => { req1 = r; }], [req2, (r: typeof req2) => { req2 = r; }]] as const) {
        if (req && !req.data) {
          try {
            const data = await fetchRequestData(cfg, req.id);
            const updated = { ...req, data };
            state.addRequest(updated);
            setter(updated);
          } catch {
            // proceed without data
          }
        }
      }

      const d1 = req1?.data?.pdo;
      const d2 = req2?.data?.pdo;

      const lines = [
        '═'.repeat(60),
        'QUERY COMPARISON',
        '═'.repeat(60),
        '',
        `Request 1: [${id1.slice(0, 12)}…] ${req1?.method} ${req1?.uri}`,
        `Request 2: [${id2.slice(0, 12)}…] ${req2?.method} ${req2?.uri}`,
        '',
        '─'.repeat(40),
        `                    Request 1       Request 2   Delta`,
        '─'.repeat(40),
        `Queries         : ${String(d1?.nb_statements ?? 'N/A').padStart(10)}  ${String(d2?.nb_statements ?? 'N/A').padStart(12)}  ${delta(d1?.nb_statements, d2?.nb_statements)}`,
        `Total time      : ${(d1?.accumulated_duration_str ?? 'N/A').padStart(10)}  ${(d2?.accumulated_duration_str ?? 'N/A').padStart(12)}`,
        `Failed          : ${String(d1?.nb_failed_statements ?? 'N/A').padStart(10)}  ${String(d2?.nb_failed_statements ?? 'N/A').padStart(12)}`,
      ];

      const t1 = req1?.data?.time;
      const t2 = req2?.data?.time;
      if (t1 || t2) {
        lines.push(`Request time    : ${(t1?.duration_str ?? 'N/A').padStart(10)}  ${(t2?.duration_str ?? 'N/A').padStart(12)}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}

function delta(a: number | undefined, b: number | undefined): string {
  if (a === undefined || b === undefined) return '';
  const d = b - a;
  if (d === 0) return '  ±0';
  return d > 0 ? `+${d}` : `${d}`;
}
