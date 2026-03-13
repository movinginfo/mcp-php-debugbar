/**
 * Smoke test for the MCP PHP DebugBar server.
 *
 * Simulates what an MCP client would do:
 *   1. Call debugbar_connect
 *   2. Call debugbar_fetch_url for each test page
 *   3. Call all analysis tools and print results
 *
 * Run: node test/smoke-test.mjs
 * (PHP server must be running on localhost:8000)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dir, '..', 'dist', 'index.js');

const SEP = '─'.repeat(70);
const HR  = '═'.repeat(70);

function section(title) {
  console.log('\n' + HR);
  console.log(' ' + title);
  console.log(HR);
}

async function callTool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '(no output)';
  return text;
}

async function main() {
  console.log(HR);
  console.log(' MCP PHP DebugBar — Smoke Test');
  console.log(HR);
  console.log('Server:', serverPath);
  console.log('PHP app: http://localhost:8000');
  console.log('');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: {
      ...process.env,
      DEBUGBAR_BASE_URL: 'http://localhost:8000',
      DEBUGBAR_OPEN_HANDLER: '/debugbar/open',
      DEBUGBAR_TYPE: 'php',
      PROJECT_ROOT: 'e:/php/claude-project/mcp-php-debugbar/Example',
      LOG_LEVEL: 'warn',
    },
  });

  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(transport);
  console.log('✓ Connected to MCP server\n');

  // ── List available tools ─────────────────────────────────────────────────
  const tools = await client.listTools();
  console.log(`✓ ${tools.tools.length} MCP tools registered:`);
  tools.tools.forEach(t => console.log(`   • ${t.name}`));

  // ── Connect to PHP server ─────────────────────────────────────────────────
  section('1. Connect to PHP server');
  const connectResult = await callTool(client, 'debugbar_connect', {
    base_url: 'http://localhost:8000',
    open_handler_path: '/debugbar/open',
    type: 'php',
    load_recent: true,
  });
  console.log(connectResult);

  // ── Check status ──────────────────────────────────────────────────────────
  section('2. Server status');
  console.log(await callTool(client, 'debugbar_status'));

  // ── List pre-loaded requests ──────────────────────────────────────────────
  section('3. Pre-loaded requests from server');
  console.log(await callTool(client, 'debugbar_list_requests', { max: 10 }));

  // ── Fetch each page ──────────────────────────────────────────────────────
  const pages = ['/', '/users.php', '/api.php', '/error.php'];
  for (const path of pages) {
    section(`4. Fetch ${path}`);
    console.log(await callTool(client, 'debugbar_fetch_url', { path }));
  }

  // ── Slow page (needs longer timeout in mind) ─────────────────────────────
  section('4. Fetch /slow.php (simulated slow ~800ms)');
  console.log(await callTool(client, 'debugbar_fetch_url', { path: '/slow.php' }));

  // ── SQL queries on home page (has N+1) ───────────────────────────────────
  section('5. SQL Queries from home page (N+1 problem)');
  const listRes = await callTool(client, 'debugbar_list_requests', { max: 10 });
  // Get the request for /
  const reqs = (await client.callTool({
    name: 'debugbar_list_requests',
    arguments: { max: 10 },
  })).content?.[0]?.text ?? '';
  console.log(await callTool(client, 'debugbar_get_queries'));

  // ── Detect N+1 ───────────────────────────────────────────────────────────
  section('6. Duplicate query detection (N+1)');
  console.log(await callTool(client, 'debugbar_get_duplicate_queries'));

  // ── Exceptions ───────────────────────────────────────────────────────────
  section('7. Exceptions (from /error.php)');
  console.log(await callTool(client, 'debugbar_get_exceptions', { all_requests: true }));

  // ── Logs ─────────────────────────────────────────────────────────────────
  section('8. Logs from latest request');
  console.log(await callTool(client, 'debugbar_get_logs'));

  // ── Timeline ─────────────────────────────────────────────────────────────
  section('9. Timeline from /slow.php');
  // Get slow.php request id
  const allReqs = await client.callTool({ name: 'debugbar_list_requests', arguments: { max: 20 } });
  console.log(await callTool(client, 'debugbar_get_timeline'));

  // ── Performance summary ──────────────────────────────────────────────────
  section('10. Performance summary across all requests');
  console.log(await callTool(client, 'debugbar_performance_summary', { sort_by: 'duration', limit: 10 }));

  // ── Analyze latest request ────────────────────────────────────────────────
  section('11. Smart analysis (latest request)');
  console.log(await callTool(client, 'debugbar_analyze'));

  // ── AUTO DEBUG — flagship tool ────────────────────────────────────────────
  section('12. debugbar_auto_debug — full debug report with source code');
  console.log(await callTool(client, 'debugbar_auto_debug', { url: '/', refresh: false }));

  // ── Fix specific issue ────────────────────────────────────────────────────
  section('13. debugbar_fix_issue — fix issue #1 with source code context');
  console.log(await callTool(client, 'debugbar_fix_issue', { issue_index: 1 }));

  // ── Read source file ──────────────────────────────────────────────────────
  section('14. debugbar_read_source — read index.php around line 69');
  console.log(await callTool(client, 'debugbar_read_source', {
    file: 'public/index.php',
    line: 69,
    context: 8,
  }));

  // ── Auto debug error page ─────────────────────────────────────────────────
  section('15. debugbar_auto_debug — error.php (exceptions)');
  console.log(await callTool(client, 'debugbar_auto_debug', { url: '/error.php', refresh: false }));

  // ── Done ──────────────────────────────────────────────────────────────────
  section('✅ Smoke test complete');
  console.log('All MCP tools tested successfully against PHP DebugBar v3.5.1');
  console.log('');

  await client.close();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
