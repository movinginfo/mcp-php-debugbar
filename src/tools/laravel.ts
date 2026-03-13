import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { state } from '../state.js';
import { fetchRequestData } from '../debugbar/client.js';
import {
  formatRoute,
  formatViews,
  formatEvents,
  formatAuth,
  formatModels,
  formatCache,
  formatSession,
  formatExceptions,
  formatTimeline,
  formatQueries,
  formatLogs,
} from '../debugbar/formatter.js';

async function loadRequest(id?: string) {
  if (!state.connected || !state.connectionConfig) return null;
  let req = id ? state.getRequest(id) : state.getLatestRequest();
  if (!req) return null;
  if (!req.data) {
    try {
      const data = await fetchRequestData(state.connectionConfig, req.id);
      req = { ...req, data };
      state.addRequest(req);
    } catch {
      return req;
    }
  }
  return req;
}

export function registerLaravelTools(server: McpServer): void {

  // ─── Route ────────────────────────────────────────────────────────

  server.tool(
    'debugbar_get_route',
    'Get Laravel route information for a request: URI, action, middleware, route name, and constraints.',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
    },
    async ({ id }) => {
      const req = await loadRequest(id);
      if (!req) return { content: [{ type: 'text', text: '❌ Not connected or no requests found.' }] };
      if (!req.data) return { content: [{ type: 'text', text: '❌ No data loaded for this request.' }] };
      return { content: [{ type: 'text', text: formatRoute(req.data) }] };
    },
  );

  // ─── Views ────────────────────────────────────────────────────────

  server.tool(
    'debugbar_get_views',
    'Get all Blade views / templates rendered during a Laravel request, including component count and variable count.',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
    },
    async ({ id }) => {
      const req = await loadRequest(id);
      if (!req) return { content: [{ type: 'text', text: '❌ Not connected or no requests found.' }] };
      if (!req.data) return { content: [{ type: 'text', text: '❌ No data loaded.' }] };
      return { content: [{ type: 'text', text: formatViews(req.data) }] };
    },
  );

  // ─── Events ───────────────────────────────────────────────────────

  server.tool(
    'debugbar_get_events',
    'Get all Laravel events fired during a request with listener details and dispatch location.',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
      search: z.string().optional().describe('Filter events containing this text.'),
    },
    async ({ id, search }) => {
      const req = await loadRequest(id);
      if (!req) return { content: [{ type: 'text', text: '❌ Not connected or no requests found.' }] };
      if (!req.data) return { content: [{ type: 'text', text: '❌ No data loaded.' }] };

      let data = req.data;
      if (search && data.events) {
        const searchLower = search.toLowerCase();
        const filtered = data.events.events.filter(e =>
          e.event.toLowerCase().includes(searchLower),
        );
        data = { ...data, events: { count: filtered.length, events: filtered } };
      }

      return { content: [{ type: 'text', text: formatEvents(data) }] };
    },
  );

  // ─── Auth ─────────────────────────────────────────────────────────

  server.tool(
    'debugbar_get_auth',
    'Get authentication state for a Laravel request — which guards are active and the authenticated user details.',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
    },
    async ({ id }) => {
      const req = await loadRequest(id);
      if (!req) return { content: [{ type: 'text', text: '❌ Not connected or no requests found.' }] };
      if (!req.data) return { content: [{ type: 'text', text: '❌ No data loaded.' }] };
      return { content: [{ type: 'text', text: formatAuth(req.data) }] };
    },
  );

  // ─── Models ───────────────────────────────────────────────────────

  server.tool(
    'debugbar_get_models',
    'Get Eloquent model statistics for a Laravel request — which models were loaded and how many instances.',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
    },
    async ({ id }) => {
      const req = await loadRequest(id);
      if (!req) return { content: [{ type: 'text', text: '❌ Not connected or no requests found.' }] };
      if (!req.data) return { content: [{ type: 'text', text: '❌ No data loaded.' }] };
      return { content: [{ type: 'text', text: formatModels(req.data) }] };
    },
  );

  // ─── Cache ────────────────────────────────────────────────────────

  server.tool(
    'debugbar_get_cache',
    'Get cache operations (hits, misses, writes, deletes) during a Laravel request.',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
      type: z
        .enum(['hit', 'miss', 'write', 'delete', 'forget'])
        .optional()
        .describe('Filter by operation type.'),
    },
    async ({ id, type }) => {
      const req = await loadRequest(id);
      if (!req) return { content: [{ type: 'text', text: '❌ Not connected or no requests found.' }] };
      if (!req.data) return { content: [{ type: 'text', text: '❌ No data loaded.' }] };

      let data = req.data;
      if (type && data.cache) {
        const filtered = data.cache.measures.filter(
          m => m.type?.toLowerCase() === type.toLowerCase(),
        );
        data = { ...data, cache: { count: filtered.length, measures: filtered } };
      }

      return { content: [{ type: 'text', text: formatCache(data) }] };
    },
  );

  // ─── Session ──────────────────────────────────────────────────────

  server.tool(
    'debugbar_get_session',
    'Get session data stored during a Laravel request.',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
    },
    async ({ id }) => {
      const req = await loadRequest(id);
      if (!req) return { content: [{ type: 'text', text: '❌ Not connected or no requests found.' }] };
      if (!req.data) return { content: [{ type: 'text', text: '❌ No data loaded.' }] };
      return { content: [{ type: 'text', text: formatSession(req.data) }] };
    },
  );

  // ─── Full Laravel debug report ────────────────────────────────────

  server.tool(
    'debugbar_laravel_report',
    'Generate a comprehensive Laravel debug report for a request: route, auth, queries, events, views, models, cache, exceptions, and timeline in one output.',
    {
      id: z.string().optional().describe('Request ID. Uses most recent if omitted.'),
    },
    async ({ id }) => {
      const req = await loadRequest(id);
      if (!req) return { content: [{ type: 'text', text: '❌ Not connected or no requests found.' }] };
      if (!req.data) return { content: [{ type: 'text', text: '❌ No data loaded.' }] };

      const d = req.data;
      const HR = '═'.repeat(60);
      const sections: string[] = [];

      sections.push(`${HR}\nLARAVEL DEBUG REPORT\n${HR}`);
      sections.push(`Request: ${req.method} ${req.uri}`);
      sections.push(`Time   : ${req.datetime}`);

      if (d.laravel) {
        sections.push(`\nLaravel ${d.laravel.laravel_version} | PHP ${d.laravel.php_version} | env: ${d.laravel.environment}`);
      }

      if (d.exceptions?.count) sections.push('\n' + formatExceptions(d));
      if (d.route) sections.push('\n' + formatRoute(d));
      if (d.auth) sections.push('\n' + formatAuth(d));
      if (d.time) sections.push('\n' + formatTimeline(d));
      if (d.pdo?.nb_statements) sections.push('\n' + formatQueries(d));
      if (d.models?.count) sections.push('\n' + formatModels(d));
      if (d.cache?.count) sections.push('\n' + formatCache(d));
      if (d.views?.nb_templates) sections.push('\n' + formatViews(d));
      if (d.events?.count) sections.push('\n' + formatEvents(d));
      if (d.messages?.count) sections.push('\n' + formatLogs(d));

      return { content: [{ type: 'text', text: sections.join('\n') }] };
    },
  );
}
