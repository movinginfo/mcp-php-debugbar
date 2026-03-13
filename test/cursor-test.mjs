/**
 * Test for Cursor-specific tools:
 *   debugbar_open_preview, debugbar_start_polling, debugbar_auto_analyze,
 *   debugbar_analyze_all, debugbar_suggest_fixes, debugbar_watch_and_debug
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dir, '..', 'dist', 'index.js');
const HR = '═'.repeat(70);

async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return res.content?.[0]?.text ?? '(no output)';
}

async function main() {
  console.log(HR);
  console.log(' Cursor Integration Test');
  console.log(HR + '\n');

  const transport = new StdioClientTransport({
    command: 'node', args: [serverPath],
    env: {
      ...process.env,
      DEBUGBAR_BASE_URL: 'http://localhost:8000',
      DEBUGBAR_OPEN_HANDLER: '/debugbar/open',
      DEBUGBAR_TYPE: 'php',
      LOG_LEVEL: 'warn',
    },
  });

  const client = new Client({ name: 'cursor-test', version: '1.0.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  const cursorTools = tools.tools.filter(t =>
    ['debugbar_open_preview','debugbar_start_polling','debugbar_auto_analyze',
     'debugbar_analyze_all','debugbar_suggest_fixes','debugbar_watch_and_debug',
     'debugbar_preview_modes','debugbar_webhook_start'].includes(t.name)
  );
  console.log(`✓ ${cursorTools.length} Cursor-specific tools registered:`);
  cursorTools.forEach(t => console.log(`   • ${t.name}`));
  console.log('');

  // Connect
  await call(client, 'debugbar_connect', {
    base_url: 'http://localhost:8000',
    open_handler_path: '/debugbar/open',
    type: 'php',
  });

  // Fetch all test pages
  for (const path of ['/', '/users.php', '/error.php', '/slow.php']) {
    await call(client, 'debugbar_fetch_url', { path });
  }

  // ── Preview modes ──────────────────────────────────────────────────────
  console.log(HR);
  console.log(' 1. Preview Modes');
  console.log(HR);
  console.log(await call(client, 'debugbar_preview_modes'));

  // ── Open preview instructions ─────────────────────────────────────────
  console.log(HR);
  console.log(' 2. Open Preview (Chrome + Cursor)');
  console.log(HR);
  console.log(await call(client, 'debugbar_open_preview', {
    url: 'http://localhost:8000',
    mode: 'all',
    cdp_port: 9222,
  }));

  // ── Auto analyze (home page / with N+1) ───────────────────────────────
  console.log(HR);
  console.log(' 3. Auto-Analyze home page (N+1 + exception)');
  console.log(HR);
  // Get the / request id
  const listRes = await client.callTool({ name: 'debugbar_list_requests', arguments: { max: 20 } });
  const listText = listRes.content?.[0]?.text ?? '';
  const homeMatch = listText.match(/\[([a-f0-9]{32})\][^\n]*\n\s+GET\s+\/\s/);
  const homeId = homeMatch?.[1];

  console.log(await call(client, 'debugbar_auto_analyze', {
    id: homeId,
    slow_query_ms: 100,
  }));

  // ── Suggest fixes ─────────────────────────────────────────────────────
  console.log(HR);
  console.log(' 4. Suggest Fixes for home page');
  console.log(HR);
  console.log(await call(client, 'debugbar_suggest_fixes', {
    id: homeId,
    include_code: true,
  }));

  // ── Analyze all ───────────────────────────────────────────────────────
  console.log(HR);
  console.log(' 5. Analyze ALL requests');
  console.log(HR);
  console.log(await call(client, 'debugbar_analyze_all', {
    limit: 10,
    min_severity: 'warning',
  }));

  // ── Polling test ──────────────────────────────────────────────────────
  console.log(HR);
  console.log(' 6. Start polling (3s), fetch a URL, stop');
  console.log(HR);
  console.log(await call(client, 'debugbar_start_polling', { interval_ms: 1500 }));

  // Simulate a new request while polling
  await new Promise(r => setTimeout(r, 500));
  await call(client, 'debugbar_fetch_url', { path: '/api.php' });
  await new Promise(r => setTimeout(r, 2000));

  console.log(await call(client, 'debugbar_stop_polling'));
  console.log('\nRequests after polling:');
  console.log(await call(client, 'debugbar_list_requests', { max: 5 }));

  console.log(HR);
  console.log(' ✅ All Cursor integration tests passed!');
  console.log(HR);

  await client.close();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
