import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { state } from '../state.js';
import { fetchRequestData } from '../debugbar/client.js';
import { formatTimeline } from '../debugbar/formatter.js';

export function registerTimelineTools(server: McpServer): void {

  server.tool(
    'debugbar_get_timeline',
    'Get the performance timeline for a PHP/Laravel request. Shows measured code blocks, their duration, and relative start times.',
    {
      id: z
        .string()
        .optional()
        .describe('Request ID. Uses most recent if omitted.'),
      min_duration_ms: z
        .number()
        .optional()
        .describe('Only show measures taking longer than this (ms). Default: 0'),
    },
    async ({ id, min_duration_ms = 0 }) => {
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
      if (min_duration_ms > 0 && data.time) {
        const filtered = data.time.measures.filter(m => m.duration >= min_duration_ms);
        data = { ...data, time: { ...data.time, measures: filtered } };
      }

      return { content: [{ type: 'text', text: formatTimeline(data) }] };
    },
  );

  // ─── Performance summary across requests ─────────────────────────

  server.tool(
    'debugbar_performance_summary',
    'Show a performance summary across all captured requests — total time, query count, memory. Useful for spotting slow pages.',
    {
      sort_by: z
        .enum(['duration', 'queries', 'memory', 'datetime'])
        .optional()
        .describe('Sort field. Default: duration'),
      limit: z.number().optional().describe('Max requests to show. Default: 20'),
    },
    async ({ sort_by = 'duration', limit = 20 }) => {
      const requests = state.requests
        .filter(r => r.data)
        .slice(0, limit);

      if (requests.length === 0) {
        return {
          content: [{ type: 'text', text: '❌ No requests with data. Use debugbar_fetch_url or browse your app.' }],
        };
      }

      // Sort
      const sorted = [...requests].sort((a, b) => {
        switch (sort_by) {
          case 'duration':
            return (b.data?.time?.duration ?? 0) - (a.data?.time?.duration ?? 0);
          case 'queries':
            return (b.data?.pdo?.nb_statements ?? 0) - (a.data?.pdo?.nb_statements ?? 0);
          case 'memory':
            return (b.data?.memory?.peak_usage ?? 0) - (a.data?.memory?.peak_usage ?? 0);
          case 'datetime':
            return b.utime - a.utime;
          default:
            return 0;
        }
      });

      const HR = '═'.repeat(80);
      const lines = [
        HR,
        `PERFORMANCE SUMMARY — ${sorted.length} request(s), sorted by ${sort_by}`,
        HR,
        '',
        `${'#'.padStart(3)}  ${'Method'.padEnd(7)} ${'URI'.padEnd(35)} ${'Time'.padStart(8)} ${'SQL'.padStart(5)} ${'Memory'.padStart(10)}`,
        '─'.repeat(80),
      ];

      sorted.forEach((req, idx) => {
        const d = req.data!;
        const method = req.method.padEnd(7);
        const uri = req.uri.slice(0, 34).padEnd(35);
        const time = (d.time?.duration_str ?? '—').padStart(8);
        const sql = String(d.pdo?.nb_statements ?? '—').padStart(5);
        const mem = (d.memory?.peak_usage_str ?? '—').padStart(10);
        const exc = d.exceptions?.count ? ` ⚠️ ${d.exceptions.count}exc` : '';
        lines.push(`${String(idx + 1).padStart(3)}. ${method} ${uri} ${time} ${sql} ${mem}${exc}`);
      });

      lines.push('');
      lines.push(`Use debugbar_get_request with the request ID for full details.`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
