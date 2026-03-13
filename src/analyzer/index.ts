/**
 * Smart analysis engine for PHP DebugBar data.
 *
 * Detects common PHP/Laravel issues from captured debug data and generates
 * actionable fix suggestions for AI assistants in Cursor.
 *
 * Issue categories:
 *   n+1          — Duplicate/repeated SQL queries (N+1 problem)
 *   slow-query   — Queries taking more than threshold
 *   failed-query — Queries that returned an error
 *   exception    — Uncaught/caught exceptions with stack traces
 *   memory       — Peak memory usage over threshold
 *   performance  — Timeline bottlenecks
 *   missing-index — Queries doing full table scans (EXPLAIN support)
 */

import {
  CapturedRequest,
  DebugBarData,
  DebugBarStatement,
  DebugBarException,
  DebugBarMeasure,
} from '../debugbar/types.js';

// ─── Issue types ──────────────────────────────────────────────────────────

export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueCategory =
  | 'n+1'
  | 'slow-query'
  | 'failed-query'
  | 'exception'
  | 'memory'
  | 'performance'
  | 'missing-index'
  | 'large-response';

export interface Issue {
  severity: IssueSeverity;
  category: IssueCategory;
  title: string;
  description: string;
  /** Concrete code-level suggestion for the AI to act on */
  suggestion: string;
  /** Source file implicated (if known) */
  file?: string;
  line?: number;
  /** Raw SQL for query-related issues */
  sql?: string;
  /** Number of occurrences (for duplicates) */
  count?: number;
  /** Duration in ms (for perf issues) */
  durationMs?: number;
}

export interface AnalysisResult {
  requestId: string;
  uri: string;
  method: string;
  /** Health score 0–100 (100 = perfect) */
  score: number;
  issues: Issue[];
  /** One-line summary for inline display */
  summary: string;
  /** Ordered list of concrete actions the AI can suggest/perform */
  quickFixes: string[];
  /** Stats snapshot */
  stats: {
    totalQueries: number;
    duplicateQueries: number;
    failedQueries: number;
    slowQueries: number;
    totalQueryMs: number;
    exceptions: number;
    peakMemoryMb: number;
    totalRequestMs: number;
  };
}

// ─── Thresholds (can be overridden) ──────────────────────────────────────

export interface AnalyzerConfig {
  slowQueryMs: number;         // default 200ms
  criticalQueryMs: number;     // default 1000ms
  memoryWarningMb: number;     // default 32MB
  memoryCriticalMb: number;    // default 128MB
  slowRequestMs: number;       // default 500ms
  criticalRequestMs: number;   // default 2000ms
  duplicateMinCount: number;   // default 2
}

const DEFAULT_CONFIG: AnalyzerConfig = {
  slowQueryMs: 200,
  criticalQueryMs: 1000,
  memoryWarningMb: 32,
  memoryCriticalMb: 128,
  slowRequestMs: 500,
  criticalRequestMs: 2000,
  duplicateMinCount: 2,
};

// ─── Main analyze function ────────────────────────────────────────────────

export function analyzeRequest(
  req: CapturedRequest,
  config: Partial<AnalyzerConfig> = {},
): AnalysisResult | null {
  if (!req.data) return null;

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const data = req.data;
  const issues: Issue[] = [];

  // Run all detectors
  detectNPlusOne(data, issues, cfg);
  detectSlowQueries(data, issues, cfg);
  detectFailedQueries(data, issues);
  detectExceptions(data, issues);
  detectMemory(data, issues, cfg);
  detectPerformanceBottlenecks(data, issues, cfg);

  // Sort: critical first
  issues.sort((a, b) => {
    const order: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  const score = computeScore(issues, data, cfg);
  const stats = buildStats(data);
  const summary = buildSummary(issues, stats, req);
  const quickFixes = buildQuickFixes(issues);

  return {
    requestId: req.id,
    uri: req.uri,
    method: req.method,
    score,
    issues,
    summary,
    quickFixes,
    stats,
  };
}

// ─── Analyze multiple requests ────────────────────────────────────────────

export function analyzeAll(
  requests: CapturedRequest[],
  config: Partial<AnalyzerConfig> = {},
): AnalysisResult[] {
  return requests
    .filter(r => r.data)
    .map(r => analyzeRequest(r, config))
    .filter((r): r is AnalysisResult => r !== null);
}

// ─── N+1 Detector ─────────────────────────────────────────────────────────

function detectNPlusOne(
  data: DebugBarData,
  issues: Issue[],
  cfg: AnalyzerConfig,
): void {
  if (!data.pdo?.statements?.length) return;

  // Group by normalized SQL (strip literal values)
  const groups = new Map<string, { count: number; stmts: DebugBarStatement[] }>();

  for (const stmt of data.pdo.statements) {
    // Normalize: replace IN (?,...), = ?, numeric and string literals
    const normalized = normalizeSql(stmt.sql);
    const existing = groups.get(normalized);
    if (existing) {
      existing.count++;
      existing.stmts.push(stmt);
    } else {
      groups.set(normalized, { count: 1, stmts: [stmt] });
    }
  }

  for (const [normalized, { count, stmts }] of groups) {
    if (count < cfg.duplicateMinCount) continue;

    const stmt = stmts[0];
    const totalMs = stmts.reduce((s, q) => s + q.duration, 0);
    const severity: IssueSeverity = count >= 10 ? 'critical' : 'warning';

    // Try to identify the model from SQL
    const tableMatch = normalized.match(/FROM\s+[`"]?(\w+)[`"]?/i);
    const table = tableMatch?.[1] ?? 'unknown';

    // Try to get the caller file
    const file = stmt.backtrace?.[0]?.file;
    const line = stmt.backtrace?.[0]?.line;

    issues.push({
      severity,
      category: 'n+1',
      title: `N+1 Query: "${table}" queried ${count}×`,
      description: `The query was executed ${count} times (total ${ms(totalMs)}). ` +
        `This is a classic N+1 problem — a query runs once per item in a loop.`,
      suggestion: buildN1Suggestion(table, normalized, count, file),
      file,
      line,
      sql: stmt.sql,
      count,
      durationMs: totalMs,
    });
  }
}

function buildN1Suggestion(
  table: string,
  sql: string,
  count: number,
  file?: string,
): string {
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  const isLaravel = file?.includes('app/') || file?.includes('\\app\\');

  if (isLaravel && isSelect) {
    const modelGuess = table
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/ /g, '')
      .replace(/s$/, ''); // naive singularize

    return [
      `Use Eloquent eager loading to eliminate this N+1:`,
      ``,
      `// Instead of:`,
      `$items = Model::all();`,
      `foreach ($items as $item) {`,
      `    $item->${table}; // fires query each iteration`,
      `}`,
      ``,
      `// Use:`,
      `$items = Model::with('${table}')->get();`,
      ``,
      `Or for multiple relations:`,
      `$items = Model::with(['${table}', 'otherRelation'])->get();`,
    ].join('\n');
  }

  return `Execute a single JOIN or sub-select instead of ${count} separate queries.\n` +
    `Consider: SELECT main.*, rel.* FROM main_table JOIN ${table} ON ...`;
}

// ─── Slow Query Detector ───────────────────────────────────────────────────

function detectSlowQueries(
  data: DebugBarData,
  issues: Issue[],
  cfg: AnalyzerConfig,
): void {
  if (!data.pdo?.statements?.length) return;

  for (const stmt of data.pdo.statements) {
    if (stmt.duration < cfg.slowQueryMs) continue;

    const severity: IssueSeverity = stmt.duration >= cfg.criticalQueryMs ? 'critical' : 'warning';
    const file = stmt.backtrace?.[0]?.file;
    const line = stmt.backtrace?.[0]?.line;

    issues.push({
      severity,
      category: 'slow-query',
      title: `Slow query: ${stmt.duration_str}`,
      description: `A SQL query took ${stmt.duration_str}${stmt.row_count !== undefined ? ` and returned ${stmt.row_count} rows` : ''}.`,
      suggestion: buildSlowQuerySuggestion(stmt),
      file,
      line,
      sql: stmt.sql,
      durationMs: stmt.duration,
    });
  }
}

function buildSlowQuerySuggestion(stmt: DebugBarStatement): string {
  const sql = stmt.sql.trim().toUpperCase();
  const lines: string[] = [];

  if (sql.includes('SELECT')) {
    // Check for missing WHERE / large scans
    if (!sql.includes('WHERE') && !sql.includes('LIMIT')) {
      lines.push('⚠ Full table scan detected — add a WHERE clause and/or LIMIT.');
    }
    if (sql.includes('LIKE') && sql.includes("'%")) {
      lines.push('⚠ Leading wildcard LIKE (e.g. LIKE \'%foo\') cannot use indexes.');
      lines.push('  Consider full-text search (FULLTEXT index, Meilisearch, or Elasticsearch).');
    }
    if (!sql.includes('INDEX') && stmt.duration > 200) {
      lines.push(`Add an index on the column(s) used in WHERE/JOIN:`);
      lines.push(`  php artisan make:migration add_index_to_table`);
      lines.push(`  $table->index(['column_name']);`);
    }
    if (stmt.row_count && stmt.row_count > 1000) {
      lines.push(`Query returns ${stmt.row_count} rows — add pagination:`);
      lines.push(`  ->paginate(25)  or  ->chunk(100, fn($rows) => ...)`);
    }
  }

  if (sql.includes('JOIN') && stmt.duration > 500) {
    lines.push('Ensure JOIN columns are indexed on both sides.');
  }

  if (lines.length === 0) {
    lines.push('Optimize query with EXPLAIN, add indexes, or cache the result:');
    lines.push('  Cache::remember("key", 3600, fn() => /* your query */);');
  }

  return lines.join('\n');
}

// ─── Failed Query Detector ─────────────────────────────────────────────────

function detectFailedQueries(data: DebugBarData, issues: Issue[]): void {
  if (!data.pdo?.statements?.length) return;

  for (const stmt of data.pdo.statements) {
    if (stmt.is_success) continue;

    issues.push({
      severity: 'critical',
      category: 'failed-query',
      title: `Failed SQL query`,
      description: stmt.error_message
        ? `Query failed: ${stmt.error_message}`
        : 'A SQL query returned an error.',
      suggestion: [
        `Fix the SQL error:`,
        `  ${stmt.sql.slice(0, 200)}`,
        ``,
        stmt.error_message
          ? `Error: ${stmt.error_message}`
          : 'Check error_log or database logs for details.',
      ].join('\n'),
      file: stmt.backtrace?.[0]?.file,
      line: stmt.backtrace?.[0]?.line,
      sql: stmt.sql,
    });
  }
}

// ─── Exception Detector ───────────────────────────────────────────────────

function detectExceptions(data: DebugBarData, issues: Issue[]): void {
  if (!data.exceptions?.exceptions?.length) return;

  for (const exc of data.exceptions.exceptions) {
    // Skip if it looks like a deliberately caught & re-thrown exception
    const isCritical = !exc.file?.includes('vendor/') &&
      !['warning', 'notice'].includes(exc.type?.toLowerCase() ?? '');

    const frame = exc.stack?.[0];
    const appFrame = exc.stack?.find(f => !f.file?.includes('vendor/'));

    issues.push({
      severity: isCritical ? 'critical' : 'warning',
      category: 'exception',
      title: `${exc.type}: ${exc.message.slice(0, 80)}`,
      description: [
        `${exc.type} thrown at ${exc.file}:${exc.line}`,
        exc.code ? `Code: ${exc.code}` : '',
      ].filter(Boolean).join('\n'),
      suggestion: buildExceptionSuggestion(exc),
      file: appFrame?.file ?? exc.file,
      line: appFrame?.line ?? exc.line,
    });
  }
}

function buildExceptionSuggestion(exc: DebugBarException): string {
  const type = exc.type?.toLowerCase() ?? '';
  const msg = exc.message?.toLowerCase() ?? '';

  // Find first app-level stack frame (not vendor)
  const appFrame = exc.stack?.find(f => f.file && !f.file.includes('vendor/'));
  const location = appFrame
    ? `${appFrame.file}:${appFrame.line}`
    : `${exc.file}:${exc.line}`;

  const lines: string[] = [`Fix location: ${location}`];

  if (msg.includes('undefined variable') || msg.includes('undefined property')) {
    lines.push('', 'Initialize the variable before use or check with isset():', '  $var = $var ?? null;');
  } else if (msg.includes('call to a member function') && msg.includes('on null')) {
    lines.push('', 'Add a null check before calling the method:', '  if ($object !== null) { $object->method(); }', '  // or with optional chaining:', '  $object?->method();');
  } else if (type.includes('pdoexception') || msg.includes('sqlstate')) {
    lines.push('', 'Database error — check:', '  1. Table/column name spelling', '  2. Migration has been run: php artisan migrate', '  3. Connection config in .env (DB_HOST, DB_DATABASE, etc.)');
  } else if (msg.includes('class') && msg.includes('not found')) {
    lines.push('', 'Class not found — check:', '  1. Correct namespace: use App\\Models\\YourModel;', '  2. Composer autoload: composer dump-autoload');
  } else if (type.includes('invalidargument') || type.includes('typeerror')) {
    lines.push('', 'Invalid argument — add input validation:', '  if (!is_int($value) || $value < 1) {', "      throw new \\InvalidArgumentException('...');", '  }');
  } else if (msg.includes('permission') || msg.includes('access denied')) {
    lines.push('', 'Check file/directory permissions or Gate policies.');
  }

  return lines.join('\n');
}

// ─── Memory Detector ──────────────────────────────────────────────────────

function detectMemory(
  data: DebugBarData,
  issues: Issue[],
  cfg: AnalyzerConfig,
): void {
  if (!data.memory) return;

  const mb = data.memory.peak_usage / 1024 / 1024;
  if (mb < cfg.memoryWarningMb) return;

  const severity: IssueSeverity = mb >= cfg.memoryCriticalMb ? 'critical' : 'warning';

  issues.push({
    severity,
    category: 'memory',
    title: `High memory usage: ${data.memory.peak_usage_str}`,
    description: `Peak memory consumption was ${data.memory.peak_usage_str}.`,
    suggestion: [
      `Reduce memory usage:`,
      `  1. Use cursor() / chunk() instead of get() for large datasets:`,
      `     Model::cursor()->each(fn($row) => ...);`,
      `  2. Avoid loading large collections into memory`,
      `  3. Use select() to fetch only needed columns:`,
      `     Model::select(['id', 'name'])->get();`,
      `  4. Increase memory_limit in php.ini if legitimate:`,
      `     ini_set('memory_limit', '256M');`,
    ].join('\n'),
    durationMs: undefined,
  });
}

// ─── Performance / Timeline Detector ─────────────────────────────────────

function detectPerformanceBottlenecks(
  data: DebugBarData,
  issues: Issue[],
  cfg: AnalyzerConfig,
): void {
  if (!data.time) return;

  const totalMs = data.time.duration;

  if (totalMs >= cfg.slowRequestMs) {
    const severity: IssueSeverity = totalMs >= cfg.criticalRequestMs ? 'critical' : 'warning';

    // Find the biggest bottleneck in timeline
    const sorted = [...(data.time.measures ?? [])]
      .sort((a, b) => b.duration - a.duration);

    const top = sorted[0];
    const topPercent = top ? Math.round((top.duration / totalMs) * 100) : 0;

    issues.push({
      severity,
      category: 'performance',
      title: `Slow request: ${data.time.duration_str}`,
      description: top
        ? `Total request time is ${data.time.duration_str}. ` +
          `Biggest bottleneck: "${top.label}" (${top.duration_str}, ${topPercent}% of total).`
        : `Total request time is ${data.time.duration_str}.`,
      suggestion: buildPerfSuggestion(top, sorted, data),
      durationMs: totalMs,
    });
  }

  // Detect individual very slow timeline measurements
  for (const measure of data.time.measures ?? []) {
    if (measure.duration >= cfg.criticalQueryMs &&
        !issues.some(i => i.category === 'performance' && i.title.includes(measure.label))) {
      issues.push({
        severity: 'warning',
        category: 'performance',
        title: `Slow operation: "${measure.label}" took ${measure.duration_str}`,
        description: `The measured block "${measure.label}" took ${measure.duration_str}.`,
        suggestion: `Cache or optimise the "${measure.label}" operation:\n` +
          `  Cache::remember('${slugify(measure.label)}', 3600, function () {\n` +
          `      // expensive operation here\n  });`,
        durationMs: measure.duration,
      });
    }
  }
}

function buildPerfSuggestion(
  top: DebugBarMeasure | undefined,
  sorted: DebugBarMeasure[],
  data: DebugBarData,
): string {
  const lines: string[] = [];

  if (top) {
    const label = top.label.toLowerCase();

    if (label.includes('api') || label.includes('http') || label.includes('curl') || label.includes('external')) {
      lines.push(`External HTTP call bottleneck ("${top.label}", ${top.duration_str}). Fix:`);
      lines.push(`  1. Cache the result: Cache::remember('key', 300, fn() => Http::get(...))`);
      lines.push(`  2. Queue it: dispatch(new FetchExternalDataJob())`);
      lines.push(`  3. Run in parallel: Http::pool(fn($pool) => [ $pool->get(...), ... ])`);
    } else if (label.includes('render') || label.includes('view') || label.includes('blade')) {
      lines.push(`View rendering is slow (${top.duration_str}). Fix:`);
      lines.push(`  1. Cache views: @cache('key', 3600)...@endcache`);
      lines.push(`  2. Reduce data passed to views`);
      lines.push(`  3. Use Livewire lazy loading for heavy components`);
    } else if (label.includes('auth') || label.includes('session') || label.includes('middleware')) {
      lines.push(`Auth/middleware overhead (${top.duration_str}). Fix:`);
      lines.push(`  1. Reduce middleware stack for this route`);
      lines.push(`  2. Cache auth tokens/session data`);
    } else if (label.includes('queue') || label.includes('job')) {
      lines.push(`Move heavy operations to a queue job:`);
      lines.push(`  dispatch(new ProcessHeavyWorkJob($data))->onQueue('default');`);
    } else {
      lines.push(`Optimise "${top.label}" (${top.duration_str}):`);
      lines.push(`  Cache::remember('${slugify(top.label)}', 3600, fn() => /* logic */);`);
    }
  }

  // Suggest response caching if overall request is very slow
  const totalMs = sorted.reduce((s, m) => s + m.duration, 0);
  if (totalMs > 1000 && data.route) {
    lines.push(``, `Consider full-response caching for this route:`);
    lines.push(`  Route::get('${data.route.uri}', ...)->middleware('cache.headers:max-age=3600');`);
  }

  return lines.join('\n');
}

// ─── Scoring ──────────────────────────────────────────────────────────────

function computeScore(
  issues: Issue[],
  data: DebugBarData,
  cfg: AnalyzerConfig,
): number {
  let score = 100;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical': score -= 25; break;
      case 'warning':  score -= 10; break;
      case 'info':     score -= 2;  break;
    }
    // Extra penalty for N+1 proportional to count
    if (issue.category === 'n+1' && issue.count) {
      score -= Math.min(20, issue.count * 2);
    }
  }

  return Math.max(0, score);
}

// ─── Summary & Quick Fixes ────────────────────────────────────────────────

function buildStats(data: DebugBarData) {
  const stmts = data.pdo?.statements ?? [];
  const totalQueryMs = stmts.reduce((s, q) => s + q.duration, 0);
  const duplicateGroups = countDuplicates(stmts);

  return {
    totalQueries: stmts.length,
    duplicateQueries: duplicateGroups,
    failedQueries: stmts.filter(s => !s.is_success).length,
    slowQueries: stmts.filter(s => s.duration > 200).length,
    totalQueryMs,
    exceptions: data.exceptions?.count ?? 0,
    peakMemoryMb: (data.memory?.peak_usage ?? 0) / 1024 / 1024,
    totalRequestMs: data.time?.duration ?? 0,
  };
}

function buildSummary(
  issues: Issue[],
  stats: ReturnType<typeof buildStats>,
  req: CapturedRequest,
): string {
  if (issues.length === 0) {
    return `✅ ${req.method} ${req.uri} — no issues detected (${ms(stats.totalRequestMs)}, ${stats.totalQueries} queries)`;
  }

  const critical = issues.filter(i => i.severity === 'critical').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;

  const parts: string[] = [`${req.method} ${req.uri}:`];
  if (critical) parts.push(`${critical} critical`);
  if (warnings) parts.push(`${warnings} warning(s)`);
  if (stats.exceptions) parts.push(`${stats.exceptions} exception(s)`);
  if (stats.duplicateQueries) parts.push(`N+1 queries`);

  return (critical ? '🔴 ' : '🟡 ') + parts.join(', ') + ` | ${ms(stats.totalRequestMs)}`;
}

function buildQuickFixes(issues: Issue[]): string[] {
  const fixes: string[] = [];
  for (const issue of issues) {
    // Only top line of suggestion as a quick fix label
    const firstLine = issue.suggestion.split('\n')[0];
    if (firstLine) {
      fixes.push(`[${issue.severity.toUpperCase()}] ${issue.title}: ${firstLine}`);
    }
  }
  return fixes;
}

// ─── Format analysis as rich text ─────────────────────────────────────────

export function formatAnalysis(result: AnalysisResult): string {
  const HR = '═'.repeat(64);
  const SEP = '─'.repeat(64);
  const scoreBar = buildScoreBar(result.score);

  const lines: string[] = [
    HR,
    `🔍 ANALYSIS: ${result.method} ${result.uri}`,
    HR,
    '',
    `Health Score : ${scoreBar} ${result.score}/100`,
    `Duration     : ${ms(result.stats.totalRequestMs)}`,
    `SQL Queries  : ${result.stats.totalQueries}${result.stats.duplicateQueries ? ` (⚠ ${result.stats.duplicateQueries} duplicate pattern(s))` : ''}`,
    `Exceptions   : ${result.stats.exceptions}`,
    `Memory       : ${result.stats.peakMemoryMb.toFixed(1)} MB`,
    '',
  ];

  if (result.issues.length === 0) {
    lines.push('✅ No issues detected! Code looks healthy.');
  } else {
    lines.push(`Found ${result.issues.length} issue(s):`, '');

    result.issues.forEach((issue, idx) => {
      const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️';
      lines.push(`${idx + 1}. ${icon} [${issue.category.toUpperCase()}] ${issue.title}`);
      lines.push(`   ${issue.description.split('\n').join('\n   ')}`);
      if (issue.file) lines.push(`   📍 ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
      lines.push('');
      lines.push(`   💡 FIX:`);
      issue.suggestion.split('\n').forEach(l => lines.push(`   ${l}`));
      lines.push('');
      lines.push(SEP);
    });
  }

  if (result.quickFixes.length > 0) {
    lines.push('', 'ACTIONS FOR AI TO TAKE:', '');
    result.quickFixes.forEach((fix, i) => lines.push(`  ${i + 1}. ${fix}`));
  }

  return lines.join('\n');
}

function buildScoreBar(score: number): string {
  const filled = Math.round(score / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `[${bar}]`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function normalizeSql(sql: string): string {
  return sql
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\((\?,?\s*)+\)/g, '(?)')
    .toLowerCase();
}

function countDuplicates(stmts: DebugBarStatement[]): number {
  const seen = new Map<string, number>();
  for (const s of stmts) {
    const key = normalizeSql(s.sql);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].filter(v => v > 1).length;
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n.toFixed(0)}ms`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
