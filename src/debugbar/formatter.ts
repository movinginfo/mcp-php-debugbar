import {
  CapturedRequest,
  DebugBarData,
  DebugBarStatement,
  DebugBarException,
  DebugBarMeasure,
  LaravelView,
  LaravelEvent,
  LaravelGuard,
} from './types.js';

const SEP = '─'.repeat(60);
const HR = '═'.repeat(60);

// ─── Helpers ──────────────────────────────────────────────────────────────

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n.toFixed(2)}ms`;
}

function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

function truncate(str: string, len = 200): string {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function safeStr(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

// ─── Format request list ──────────────────────────────────────────────────

export function formatRequestList(requests: CapturedRequest[]): string {
  if (requests.length === 0) {
    return 'No captured requests. Use debugbar_connect to connect, or debugbar_fetch_url to capture a request.';
  }

  const lines: string[] = [
    HR,
    `PHP DEBUGBAR — ${requests.length} captured request(s)`,
    HR,
    '',
  ];

  requests.forEach((req, idx) => {
    const badge = req.data ? '✓' : '○';
    lines.push(
      `${String(idx + 1).padStart(3)}. ${badge} [${req.id}]`,
      `     ${req.method.padEnd(7)} ${req.uri}`,
      `     ${req.datetime} | IP: ${req.ip} | src: ${req.source}`,
    );
    if (req.data) {
      const d = req.data;
      const parts: string[] = [];
      if (d.pdo?.nb_statements) parts.push(`${d.pdo.nb_statements} SQL`);
      if (d.messages?.count) parts.push(`${d.messages.count} log`);
      if (d.exceptions?.count) parts.push(`${d.exceptions.count} exc`);
      if (d.time?.duration_str) parts.push(`⏱ ${d.time.duration_str}`);
      if (d.memory?.peak_usage_str) parts.push(`🧠 ${d.memory.peak_usage_str}`);
      if (parts.length) lines.push(`     ${parts.join(' | ')}`);
    }
    lines.push('');
  });

  lines.push(`Use debugbar_get_request with the ID to inspect a specific request.`);
  return lines.join('\n');
}

// ─── Format single request summary ────────────────────────────────────────

export function formatRequestSummary(req: CapturedRequest): string {
  const d = req.data;
  const lines: string[] = [
    HR,
    `REQUEST: ${req.method} ${req.uri}`,
    HR,
    `ID         : ${req.id}`,
    `Date/Time  : ${req.datetime}`,
    `IP Address : ${req.ip}`,
    `Source     : ${req.source}`,
  ];

  if (d?.time) {
    lines.push(`Duration   : ${d.time.duration_str}`);
  }
  if (d?.memory) {
    lines.push(`Memory     : ${d.memory.peak_usage_str}`);
  }
  if (d?.laravel) {
    lines.push(`Laravel    : ${d.laravel.laravel_version} (PHP ${d.laravel.php_version})`);
    lines.push(`Environment: ${d.laravel.environment}`);
  }
  if (d?.route) {
    const r = d.route;
    const methods = Array.isArray(r.method) ? r.method.join('|') : (r.method ?? '');
    lines.push(`Route      : ${methods} ${r.uri} → ${r.action}`);
    if (r.as) lines.push(`Route name : ${r.as}`);
    if (r.middleware?.length) lines.push(`Middleware : ${r.middleware.join(', ')}`);
  }

  lines.push('');
  lines.push(SEP);
  lines.push('COLLECTORS SUMMARY');
  lines.push(SEP);

  if (d) {
    const collectors: [string, string][] = [];
    if (d.pdo) collectors.push(['SQL Queries', `${d.pdo.nb_statements} (${d.pdo.accumulated_duration_str})`]);
    if (d.messages) collectors.push(['Messages/Logs', String(d.messages.count)]);
    if (d.exceptions) collectors.push(['Exceptions', String(d.exceptions.count)]);
    if (d.views) collectors.push(['Views', String(d.views.nb_templates)]);
    if (d.events) collectors.push(['Events', String(d.events.count)]);
    if (d.models) collectors.push(['Models', String(d.models.count)]);
    if (d.cache) collectors.push(['Cache', String(d.cache.count)]);
    if (d.auth) {
      const authedGuards = d.auth.guards.filter(g => g.is_authenticated).map(g => g.name);
      collectors.push(['Auth', authedGuards.length ? `✓ ${authedGuards.join(', ')}` : '✗ guest']);
    }

    if (collectors.length === 0) {
      lines.push('No collector data available.');
    } else {
      collectors.forEach(([name, val]) => {
        lines.push(`  ${name.padEnd(18)}: ${val}`);
      });
    }
  } else {
    lines.push('No detailed data loaded. Use debugbar_get_request with load_data: true.');
  }

  return lines.join('\n');
}

// ─── Format SQL queries ────────────────────────────────────────────────────

export function formatQueries(data: DebugBarData, limit = 50): string {
  const pdo = data.pdo;
  if (!pdo) return 'No PDO/database collector data available for this request.';

  const lines: string[] = [
    HR,
    `SQL QUERIES — ${pdo.nb_statements} total | ${pdo.accumulated_duration_str} | ${pdo.memory_usage_str}`,
    HR,
    '',
  ];

  if (pdo.nb_failed_statements > 0) {
    lines.push(`⚠️  ${pdo.nb_failed_statements} FAILED statement(s)!`);
    lines.push('');
  }

  if (pdo.statements.length === 0) {
    lines.push('No statements recorded.');
    return lines.join('\n');
  }

  const stmts = pdo.statements.slice(0, limit);
  stmts.forEach((stmt: DebugBarStatement, idx: number) => {
    const status = stmt.is_success ? '✓' : '✗';
    lines.push(`${String(idx + 1).padStart(3)}. ${status} [${stmt.duration_str}] ${stmt.type ?? 'query'}`);
    lines.push(`     SQL: ${truncate(stmt.sql, 300)}`);

    if (stmt.bindings && stmt.bindings.length > 0) {
      lines.push(`     Bindings: ${JSON.stringify(stmt.bindings)}`);
    }
    if (stmt.row_count !== undefined && stmt.row_count !== null) {
      lines.push(`     Rows: ${stmt.row_count}`);
    }
    if (stmt.connection) lines.push(`     Connection: ${stmt.connection}`);
    if (!stmt.is_success && stmt.error_message) {
      lines.push(`     ERROR: ${stmt.error_message}`);
    }
    if (stmt.backtrace && stmt.backtrace.length > 0) {
      lines.push(`     Called from: ${stmt.backtrace[0]?.file}:${stmt.backtrace[0]?.line}`);
    }
    lines.push('');
  });

  if (pdo.statements.length > limit) {
    lines.push(`… and ${pdo.statements.length - limit} more. Use limit parameter to see more.`);
  }

  // Slow query warning
  const slowStmts = pdo.statements.filter(s => s.duration > 1000);
  if (slowStmts.length > 0) {
    lines.push(SEP);
    lines.push(`⚠️  SLOW QUERIES (>1s):`);
    slowStmts.forEach(s => {
      lines.push(`  ${s.duration_str}: ${truncate(s.sql, 150)}`);
    });
  }

  return lines.join('\n');
}

// ─── Format duplicate queries ─────────────────────────────────────────────

export function formatDuplicateQueries(data: DebugBarData): string {
  const pdo = data.pdo;
  if (!pdo || pdo.statements.length === 0) {
    return 'No query data available.';
  }

  const counts = new Map<string, { count: number; duration: number; stmt: DebugBarStatement }>();
  for (const stmt of pdo.statements) {
    const key = stmt.sql.trim().toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
      existing.duration += stmt.duration;
    } else {
      counts.set(key, { count: 1, duration: stmt.duration, stmt });
    }
  }

  const dupes = [...counts.values()]
    .filter(v => v.count > 1)
    .sort((a, b) => b.count - a.count);

  if (dupes.length === 0) {
    return '✓ No duplicate queries found.';
  }

  const lines: string[] = [
    HR,
    `DUPLICATE QUERIES — ${dupes.length} unique duplicated patterns`,
    HR,
    '',
  ];

  dupes.forEach((d, idx) => {
    lines.push(`${idx + 1}. Run ${d.count}× | Total: ${ms(d.duration)}`);
    lines.push(`   SQL: ${truncate(d.stmt.sql, 200)}`);
    lines.push('');
  });

  return lines.join('\n');
}

// ─── Format logs / messages ───────────────────────────────────────────────

export function formatLogs(data: DebugBarData, levelFilter?: string): string {
  const msgs = data.messages;
  if (!msgs) return 'No messages/logs collector data available.';

  let messages = msgs.messages;
  if (levelFilter) {
    messages = messages.filter(m => m.label?.toLowerCase() === levelFilter.toLowerCase());
  }

  if (messages.length === 0) {
    return levelFilter
      ? `No ${levelFilter} messages found.`
      : 'No log messages recorded for this request.';
  }

  const lines: string[] = [
    HR,
    `LOGS / MESSAGES — ${messages.length} message(s)${levelFilter ? ` [filter: ${levelFilter}]` : ''}`,
    HR,
    '',
  ];

  const labelIcons: Record<string, string> = {
    error: '🔴',
    critical: '🔴',
    alert: '🔴',
    emergency: '🔴',
    warning: '🟡',
    warn: '🟡',
    notice: '🟡',
    info: '🔵',
    debug: '⚪',
  };

  messages.forEach((msg, idx) => {
    const icon = labelIcons[msg.label?.toLowerCase() ?? ''] ?? '▸';
    const label = (msg.label ?? 'debug').toUpperCase().padEnd(9);
    const body = safeStr(msg.message);
    lines.push(`${String(idx + 1).padStart(3)}. ${icon} [${label}] ${truncate(body, 500)}`);
  });

  return lines.join('\n');
}

// ─── Format exceptions ────────────────────────────────────────────────────

export function formatExceptions(data: DebugBarData): string {
  const exc = data.exceptions;
  if (!exc) return 'No exceptions collector data available.';
  if (exc.exceptions.length === 0) return '✓ No exceptions recorded for this request.';

  const lines: string[] = [
    HR,
    `EXCEPTIONS — ${exc.count} exception(s)`,
    HR,
    '',
  ];

  exc.exceptions.forEach((e: DebugBarException, idx: number) => {
    lines.push(`${idx + 1}. ${e.type}: ${e.message}`);
    lines.push(`   File: ${e.file}:${e.line}`);
    if (e.code) lines.push(`   Code: ${e.code}`);

    if (e.stack && e.stack.length > 0) {
      lines.push('   Stack trace:');
      const frames = e.stack.slice(0, 10);
      frames.forEach((frame, fi) => {
        const fn = frame.class
          ? `${frame.class}${frame.type ?? '::'}${frame.function ?? ''}`
          : (frame.function ?? '{closure}');
        lines.push(`     #${fi} ${frame.file}:${frame.line} → ${fn}`);
      });
      if (e.stack.length > 10) {
        lines.push(`     … ${e.stack.length - 10} more frames`);
      }
    }
    lines.push('');
  });

  return lines.join('\n');
}

// ─── Format performance timeline ─────────────────────────────────────────

export function formatTimeline(data: DebugBarData): string {
  const time = data.time;
  if (!time) return 'No timeline/time collector data available.';

  const lines: string[] = [
    HR,
    `TIMELINE — Total: ${time.duration_str}`,
    HR,
    '',
    `Start  : ${new Date(time.start * 1000).toISOString()}`,
    `End    : ${new Date(time.end * 1000).toISOString()}`,
    `Total  : ${time.duration_str}`,
    '',
  ];

  if (time.measures.length === 0) {
    lines.push('No measurements recorded.');
    return lines.join('\n');
  }

  lines.push('MEASUREMENTS:');
  lines.push('');

  const sorted = [...time.measures].sort((a, b) => b.duration - a.duration);
  const maxDur = sorted[0]?.duration ?? 1;

  sorted.forEach((m: DebugBarMeasure) => {
    const bar = buildBar(m.duration, maxDur, 30);
    lines.push(`  ${m.label}`);
    lines.push(`  ${bar} ${m.duration_str} (+${ms(m.relative_start)} start)`);
    lines.push('');
  });

  return lines.join('\n');
}

function buildBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ─── Format route (Laravel) ────────────────────────────────────────────────

export function formatRoute(data: DebugBarData): string {
  const route = data.route;
  if (!route) return 'No route collector data (requires Laravel Debugbar).';

  const methods = Array.isArray(route.method) ? route.method.join('|') : (route.method ?? '');
  const lines: string[] = [
    HR,
    'ROUTE INFORMATION',
    HR,
    '',
    `URI        : ${route.uri}`,
    `Methods    : ${methods}`,
    `Action     : ${route.action}`,
  ];

  if (route.as) lines.push(`Name       : ${route.as}`);
  if (route.prefix) lines.push(`Prefix     : ${route.prefix}`);
  if (route.namespace) lines.push(`Namespace  : ${route.namespace}`);
  if (route.middleware?.length) lines.push(`Middleware : ${route.middleware.join(', ')}`);
  if (route.file) lines.push(`File       : ${route.file}:${route.line ?? ''}`);
  if (route.wheres && Object.keys(route.wheres).length > 0) {
    lines.push(`Constraints: ${JSON.stringify(route.wheres)}`);
  }

  return lines.join('\n');
}

// ─── Format views (Laravel) ────────────────────────────────────────────────

export function formatViews(data: DebugBarData): string {
  const views = data.views;
  if (!views) return 'No views collector data (requires Laravel Debugbar).';
  if (views.nb_templates === 0) return 'No views rendered for this request.';

  const lines: string[] = [
    HR,
    `VIEWS — ${views.nb_templates} template(s) rendered`,
    HR,
    '',
  ];

  views.templates.forEach((v: LaravelView, idx: number) => {
    lines.push(`${idx + 1}. ${v.name} (rendered: ${v.rendered}×)`);
    if (v.type) lines.push(`   Type: ${v.type}`);
    if (v.param_count !== undefined) lines.push(`   Variables: ${v.param_count}`);
  });

  return lines.join('\n');
}

// ─── Format events (Laravel) ──────────────────────────────────────────────

export function formatEvents(data: DebugBarData): string {
  const events = data.events;
  if (!events) return 'No events collector data (requires Laravel Debugbar).';
  if (events.count === 0) return 'No events fired for this request.';

  const lines: string[] = [
    HR,
    `EVENTS — ${events.count} event(s) fired`,
    HR,
    '',
  ];

  events.events.forEach((e: LaravelEvent, idx: number) => {
    lines.push(`${idx + 1}. ${e.event}`);
    if (e.listeners?.length) {
      lines.push(`   Listeners: ${e.listeners.join(', ')}`);
    }
    if (e.caller) {
      lines.push(`   Fired at : ${e.caller.file}:${e.caller.line}`);
    }
  });

  return lines.join('\n');
}

// ─── Format auth (Laravel) ────────────────────────────────────────────────

export function formatAuth(data: DebugBarData): string {
  const auth = data.auth;
  if (!auth) return 'No auth collector data (requires Laravel Debugbar).';

  const lines: string[] = [
    HR,
    'AUTHENTICATION',
    HR,
    '',
  ];

  auth.guards.forEach((guard: LaravelGuard) => {
    lines.push(`Guard: ${guard.name} (${guard.label})`);
    if (guard.is_authenticated) {
      lines.push(`  Status: ✓ Authenticated${guard.is_impersonating ? ' (impersonating)' : ''}`);
      if (guard.user) {
        const user = guard.user as Record<string, unknown>;
        const id = user['id'] ?? user['ID'] ?? user['user_id'] ?? '?';
        const name = user['name'] ?? user['email'] ?? user['username'] ?? '';
        lines.push(`  User  : #${id}${name ? ` — ${name}` : ''}`);
      }
    } else {
      lines.push(`  Status: ✗ Guest`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

// ─── Format models (Laravel) ──────────────────────────────────────────────

export function formatModels(data: DebugBarData): string {
  const models = data.models;
  if (!models) return 'No models collector data (requires Laravel Debugbar with collect_models).';
  if (models.count === 0) return 'No Eloquent models loaded for this request.';

  const lines: string[] = [
    HR,
    `ELOQUENT MODELS — ${models.count} model instance(s)`,
    HR,
    '',
  ];

  // Group by model name
  const grouped = new Map<string, { action: string; count: number }[]>();
  for (const m of models.models) {
    if (!grouped.has(m.model)) grouped.set(m.model, []);
    grouped.get(m.model)!.push({ action: m.action, count: m.count ?? 1 });
  }

  for (const [modelName, actions] of grouped) {
    const total = actions.reduce((sum, a) => sum + a.count, 0);
    lines.push(`${modelName} (×${total})`);
    for (const a of actions) {
      lines.push(`  ${a.action}: ×${a.count}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Format cache (Laravel) ───────────────────────────────────────────────

export function formatCache(data: DebugBarData): string {
  const cache = data.cache;
  if (!cache) return 'No cache collector data (requires Laravel Debugbar).';
  if (cache.count === 0) return 'No cache operations for this request.';

  const lines: string[] = [
    HR,
    `CACHE — ${cache.count} operation(s)`,
    HR,
    '',
  ];

  const typeIcons: Record<string, string> = {
    hit: '✓',
    miss: '✗',
    write: '✎',
    delete: '✕',
    forget: '✕',
  };

  cache.measures.forEach((m, idx) => {
    const icon = typeIcons[m.type?.toLowerCase() ?? ''] ?? '▸';
    lines.push(`${idx + 1}. ${icon} [${(m.type ?? 'unknown').toUpperCase()}] ${m.label}`);
    if (m.duration) lines.push(`   Duration: ${m.duration}`);
    if (m.caller) lines.push(`   Called  : ${m.caller}`);
  });

  return lines.join('\n');
}

// ─── Format session (Laravel) ─────────────────────────────────────────────

export function formatSession(data: DebugBarData): string {
  const session = data.session;
  if (!session) return 'No session collector data (requires Laravel Debugbar).';

  const lines: string[] = [
    HR,
    'SESSION DATA',
    HR,
    '',
  ];

  if (typeof session === 'object' && 'data' in session && Array.isArray(session.data)) {
    const sessionObj = session as { count: number; data: { key: string; value: unknown; type: string }[] };
    lines.push(`Count: ${sessionObj.count}`);
    lines.push('');
    for (const item of sessionObj.data) {
      lines.push(`  ${item.key} (${item.type}): ${truncate(safeStr(item.value), 200)}`);
    }
  } else {
    for (const [key, val] of Object.entries(session as Record<string, unknown>)) {
      lines.push(`  ${key}: ${truncate(safeStr(val), 200)}`);
    }
  }

  return lines.join('\n');
}

// ─── Format complete request as full report ────────────────────────────────

export function formatFullReport(req: CapturedRequest): string {
  if (!req.data) {
    return formatRequestSummary(req);
  }

  const sections: string[] = [
    formatRequestSummary(req),
  ];

  if (req.data.exceptions?.count) {
    sections.push('\n' + formatExceptions(req.data));
  }
  if (req.data.time) {
    sections.push('\n' + formatTimeline(req.data));
  }
  if (req.data.pdo?.nb_statements) {
    sections.push('\n' + formatQueries(req.data));
  }
  if (req.data.messages?.count) {
    sections.push('\n' + formatLogs(req.data));
  }
  if (req.data.route) {
    sections.push('\n' + formatRoute(req.data));
  }

  return sections.join('\n');
}
