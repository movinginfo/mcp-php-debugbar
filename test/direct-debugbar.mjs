/**
 * Пряма взаємодія з PHP DebugBar + аналіз коду з фіксами.
 *
 * Запускає PHP сервер, захоплює дані з кожної сторінки,
 * читає вихідні PHP файли, показує КОНКРЕТНІ проблеми з кодом і фікси.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BASE         = 'http://localhost:8000';
const PROJECT_ROOT = path.resolve('e:\\php\\claude-project\\mcp-php-debugbar\\Example');
const HR  = '═'.repeat(72);
const SEP = '─'.repeat(72);
const DBL = '▓'.repeat(72);

// ─── HTTP helper ──────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { Accept: 'application/json' } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({
        status:  res.statusCode,
        headers: res.headers,
        body,
        json() { try { return JSON.parse(body); } catch { return null; } }
      }));
    }).on('error', reject);
  });
}

function ms(n)  { return n >= 1000 ? `${(n/1000).toFixed(2)}s` : `${(+n).toFixed(1)}ms`; }
function bar(v, mx, w = 28) { const f = mx ? Math.round((v/mx)*w) : 0; return '█'.repeat(f)+'░'.repeat(w-f); }
function trunc(s, n = 120)  { s = String(s??''); return s.length>n ? s.slice(0,n)+'…' : s; }

// ─── Source file reader ───────────────────────────────────────────────────

function resolveFile(filePath) {
  if (!filePath) return null;
  if (fs.existsSync(filePath)) return filePath;

  // Try path relative to project root (strip leading slash)
  const rel = filePath.replace(/\\/g,'/').replace(/^\//, '');
  const cand = [
    path.join(PROJECT_ROOT, rel),
    path.join(PROJECT_ROOT, 'public', path.basename(filePath)),
    path.join(PROJECT_ROOT, 'src',    path.basename(filePath)),
    path.join(PROJECT_ROOT,           path.basename(filePath)),
  ];
  return cand.find(c => fs.existsSync(c)) ?? null;
}

function readContext(filePath, targetLine, ctx = 8) {
  const resolved = resolveFile(filePath);
  if (!resolved) return null;
  try {
    const lines = fs.readFileSync(resolved, 'utf-8').split('\n');
    const start = Math.max(0, targetLine - ctx - 1);
    const end   = Math.min(lines.length, targetLine + ctx);
    return {
      file: resolved,
      relPath: path.relative(PROJECT_ROOT, resolved),
      content: lines.slice(start, end).map((l, i) => {
        const no = start + i + 1;
        const mark = no === targetLine ? '>>>' : '   ';
        return `${mark} ${String(no).padStart(4)} | ${l}`;
      }).join('\n')
    };
  } catch { return null; }
}

// ─── Normalise SQL for N+1 detection ─────────────────────────────────────

function normSql(sql) {
  return sql.replace(/'[^']*'|"\S*"|\b\d+\b/g,'?').replace(/\s+/g,' ').trim().toLowerCase();
}

// ─── Analyze & print issues with code context ─────────────────────────────

function analyzeAndPrint(data, label, urlPath) {
  const meta = data.__meta ?? {};
  const issues = [];

  // ── N+1 ──────────────────────────────────────────────────────────────
  if (data.pdo?.statements?.length) {
    const groups = {};
    for (const s of data.pdo.statements) {
      const key = normSql(s.sql);
      if (!groups[key]) groups[key] = { count:0, stmts:[] };
      groups[key].count++;
      groups[key].stmts.push(s);
    }
    for (const [sql, { count, stmts }] of Object.entries(groups)) {
      if (count < 2) continue;
      const s = stmts[0];
      const table = sql.match(/from\s+[`"]?(\w+)/)?.[1] ?? 'unknown';
      const totalMs = stmts.reduce((a, s) => a + (s.duration ?? 0), 0);
      issues.push({
        severity: count >= 5 ? 'CRITICAL' : 'WARNING',
        type: 'N+1',
        title: `N+1 Query: \`${table}\` виконується ${count}×`,
        problem: `Запит виконується ${count} разів (${ms(totalMs)} сумарно). Типова N+1 проблема — запит в циклі.`,
        sql: s.sql,
        file: s.backtrace?.[0]?.file,
        line: s.backtrace?.[0]?.line,
        fix: [
          `Замість виконання ${count} окремих запитів, зроби один запит з JOIN:`,
          ``,
          `// Поточний код (кожна ітерація = новий запит):`,
          `foreach ($users as $user) {`,
          `    $count = $pdo->query("SELECT count(*) FROM users WHERE role = ?", [$user['role']])->fetchColumn();`,
          `}`,
          ``,
          `// ✅ ВИПРАВЛЕННЯ — один запит через GROUP BY:`,
          `$roleCounts = $pdo->query(`,
          `    "SELECT role, COUNT(*) as cnt FROM users GROUP BY role"`,
          `)->fetchAll(PDO::FETCH_KEY_PAIR);`,
          `// тепер $roleCounts['admin'] = 2, тощо — без додаткових запитів`,
        ].join('\n'),
      });
    }
  }

  // ── Failed queries ────────────────────────────────────────────────────
  for (const s of (data.pdo?.statements ?? [])) {
    if (s.is_success) continue;
    issues.push({
      severity: 'CRITICAL',
      type: 'SQL_ERROR',
      title: `SQL Error: ${trunc(s.error_message ?? s.sql, 60)}`,
      problem: `Запит завершився з помилкою: ${s.error_message ?? 'unknown error'}`,
      sql: s.sql,
      file: s.backtrace?.[0]?.file,
      line: s.backtrace?.[0]?.line,
      fix: [
        `Перевір: таблиця існує, правильне ім'я, є міграція.`,
        `Запит: ${s.sql}`,
        `Помилка: ${s.error_message ?? '(немає деталей)'}`,
      ].join('\n'),
    });
  }

  // ── Exceptions ───────────────────────────────────────────────────────
  for (const e of (data.exceptions?.exceptions ?? [])) {
    const type    = e.type?.toLowerCase() ?? '';
    const msg     = e.message?.toLowerCase() ?? '';
    const appFrame = e.stack?.find(f => f.file && !f.file.includes('/vendor/') && !f.file.includes('\\vendor\\'));

    let fix = `Виправ в файлі ${e.file}:${e.line}`;
    if (msg.includes('on null') || msg.includes('member function')) {
      fix = [
        `Об'єкт або змінна = null перед викликом методу.`,
        ``,
        `// ✅ ВИПРАВЛЕННЯ — null-перевірка:`,
        `if ($object !== null) {`,
        `    $object->method();`,
        `}`,
        `// або PHP 8 null-safe operator:`,
        `$result = $object?->method();`,
      ].join('\n');
    } else if (msg.includes('sqlstate') || type.includes('pdoexception')) {
      fix = [
        `Помилка бази даних. Перевір:`,
        `  1. Ім'я таблиці/колонки (опечатка?)`,
        `  2. php artisan migrate (таблиця існує?)`,
        `  3. .env: DB_DATABASE, DB_HOST, DB_PASSWORD`,
      ].join('\n');
    } else if (type.includes('invalidargument') || type.includes('typeerror')) {
      fix = [
        `Неправильний тип аргументу. Додай валідацію:`,
        ``,
        `if (!is_int($value) || $value < 1) {`,
        `    throw new \\InvalidArgumentException("ID must be positive int, got: $value");`,
        `}`,
      ].join('\n');
    }

    issues.push({
      severity: 'CRITICAL',
      type: 'EXCEPTION',
      title: `${e.type}: ${trunc(e.message, 60)}`,
      problem: `${e.type} кинуто в ${e.file}:${e.line}`,
      file: appFrame?.file ?? e.file,
      line: appFrame?.line ?? e.line,
      fix,
    });
  }

  // ── Slow request ─────────────────────────────────────────────────────
  if (data.time?.duration > 500) {
    const sorted = [...(data.time.measures ?? [])].sort((a,b) => b.duration - a.duration);
    const top = sorted[0];
    if (top) {
      const pct = Math.round((top.duration / data.time.duration) * 100);
      let fix = `Кешуй або оптимізуй операцію "${top.label}".`;
      const lbl = top.label.toLowerCase();
      if (lbl.includes('api') || lbl.includes('external') || lbl.includes('http')) {
        fix = [
          `Зовнішній HTTP-запит — вузьке місце (${pct}% часу).`,
          ``,
          `// ✅ ВИПРАВЛЕННЯ — кешуй результат:`,
          `$key = 'external_api_' . md5($url);`,
          `$result = apcu_fetch($key, $ok);`,
          `if (!$ok) {`,
          `    $result = file_get_contents($url); // або curl`,
          `    apcu_store($key, $result, 300);     // кеш на 5 хвилин`,
          `}`,
        ].join('\n');
      } else if (lbl.includes('db') || lbl.includes('query')) {
        fix = `Запит до БД повільний (${ms(top.duration)}). Додай індекс або кеш.`;
      }
      issues.push({
        severity: 'WARNING',
        type: 'PERFORMANCE',
        title: `Повільний запит: ${ms(data.time.duration)} (бот. місце: "${top.label}" ${pct}%)`,
        problem: `Загальний час: ${data.time.duration_str}. Найповільніша операція: "${top.label}" (${top.duration_str}, ${pct}%).`,
        fix,
      });
    }
  }

  // ── Print raw data ───────────────────────────────────────────────────
  console.log('\n' + HR);
  console.log(`  📋  ${meta.method ?? 'GET'}  ${meta.uri ?? urlPath}  |  ${label}`);
  console.log(`  ID: ${meta.id}  |  ${meta.datetime}  |  ${data.time?.duration_str ?? '?'}  |  ${data.memory?.peak_usage_str ?? '?'}`);
  console.log(HR);

  // Timeline
  if (data.time?.measures?.length) {
    const measures = data.time.measures;
    const maxDur = Math.max(...measures.map(m => m.duration));
    console.log('\n  ⏱  TIMELINE:');
    for (const m of [...measures].sort((a,b) => b.duration - a.duration)) {
      const slow = m.duration > 200 ? ' ⚠' : '';
      console.log(`    ${m.label.padEnd(28)} [${bar(m.duration, maxDur)}] ${m.duration_str}${slow}`);
    }
  }

  // SQL
  if (data.pdo?.statements?.length) {
    const pdo = data.pdo;
    console.log(`\n  🗄  SQL: ${pdo.nb_statements} запит(ів), ${pdo.accumulated_duration_str}`);
    if (pdo.nb_failed_statements > 0) console.log(`  ⚠  ПОМИЛКИ: ${pdo.nb_failed_statements}`);
    for (let i = 0; i < pdo.statements.length; i++) {
      const s = pdo.statements[i];
      const ok = s.is_success ? '✓' : '✗ FAILED';
      console.log(`    ${String(i+1).padStart(2)}.${ok} [${s.duration_str}]  ${trunc(s.sql, 80)}`);
      if (!s.is_success) console.log(`       ERROR: ${s.error_message}`);
      if (s.backtrace?.[0]) console.log(`       ↳ ${s.backtrace[0].file}:${s.backtrace[0].line}`);
    }
  }

  // Exceptions
  if (data.exceptions?.exceptions?.length) {
    console.log(`\n  💥  EXCEPTIONS: ${data.exceptions.count}`);
    for (const e of data.exceptions.exceptions) {
      console.log(`    ${e.type}: ${e.message}`);
      console.log(`       at ${e.file}:${e.line}`);
    }
  }

  // Logs
  if (data.messages?.messages?.length) {
    const icons = { error:'🔴', warning:'🟡', warn:'🟡', info:'🔵', debug:'⚪', notice:'🟡' };
    console.log(`\n  📝  LOGS: ${data.messages.count}`);
    for (const m of data.messages.messages) {
      const icon = icons[m.label?.toLowerCase()] ?? '▸';
      const body = typeof m.message === 'string' ? m.message : JSON.stringify(m.message);
      console.log(`    ${icon} [${(m.label??'').toUpperCase().padEnd(8)}]  ${trunc(body, 90)}`);
    }
  }

  // ── Print issues with code context ─────────────────────────────────
  if (issues.length === 0) {
    console.log('\n  ✅ Проблем не знайдено.');
    return;
  }

  console.log(`\n${DBL}`);
  console.log(`  🔍 АНАЛІЗ: ${issues.length} проблем(и) знайдено`);
  console.log(DBL);

  issues.forEach((issue, idx) => {
    const icon = issue.severity === 'CRITICAL' ? '🔴' : '🟡';
    console.log(`\n  ${icon} [${issue.type}] #${idx+1}: ${issue.title}`);
    console.log(`  ${SEP.slice(4)}`);
    console.log(`  Проблема: ${issue.problem}`);

    // Source code context
    if (issue.file && issue.line) {
      const ctx = readContext(issue.file, issue.line);
      if (ctx) {
        console.log(`\n  📍 Код (${ctx.relPath}:${issue.line}):`);
        console.log('');
        for (const l of ctx.content.split('\n')) {
          console.log('    ' + l);
        }
      } else {
        console.log(`  📍 Файл: ${issue.file}:${issue.line}  (не знайдено в PROJECT_ROOT)`);
      }
    }

    if (issue.sql) {
      console.log(`\n  🗄  SQL: ${trunc(issue.sql, 100)}`);
    }

    console.log(`\n  💡 ВИПРАВЛЕННЯ:`);
    for (const l of issue.fix.split('\n')) {
      console.log('    ' + l);
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(HR);
  console.log('  PHP DEBUGBAR — DEBUG + АНАЛІЗ КОДУ');
  console.log(`  Server      : ${BASE}`);
  console.log(`  Project root: ${PROJECT_ROOT}`);
  console.log(HR + '\n');

  // Перевірка сервера
  try {
    await get(`${BASE}/`);
  } catch {
    console.log('❌ PHP сервер не запущено. Запускаємо...');
    const phpExe = 'php';
    const docRoot = path.join(PROJECT_ROOT, 'public');
    const router  = path.join(PROJECT_ROOT, 'public', 'router.php');
    require('child_process').spawn(phpExe, ['-S', 'localhost:8000', '-t', docRoot, router], {
      detached: true, stdio: 'ignore'
    }).unref();
    await new Promise(r => setTimeout(r, 1500));
  }

  // Захоплюємо кожну сторінку
  const pages = [
    { urlPath: '/',          label: 'Головна (N+1 + exception)' },
    { urlPath: '/users.php', label: 'Users' },
    { urlPath: '/error.php', label: 'Errors (4 exceptions)' },
    { urlPath: '/slow.php',  label: 'Slow page (timeline)' },
  ];

  console.log('[ Захоплюємо запити ]\n');

  for (const { urlPath, label } of pages) {
    process.stdout.write(`  GET ${urlPath.padEnd(18)} (${label}) ... `);
    let res;
    try {
      res = await get(`${BASE}${urlPath}`);
    } catch (e) {
      console.log(`✗ помилка: ${e.message}`);
      continue;
    }

    const debugbarId = res.headers['phpdebugbar-id'];
    if (!debugbarId) {
      console.log(`✗ немає phpdebugbar-id (HTTP ${res.status})`);
      continue;
    }
    console.log(`✓  ID=${debugbarId}`);

    // Завантажити повні дані
    const dataRes = await get(`${BASE}/debugbar/open?id=${debugbarId}`);
    const data    = dataRes.json();
    if (!data || typeof data !== 'object') {
      console.log(`  ✗ Не вдалося отримати дані для ${debugbarId}`);
      continue;
    }

    analyzeAndPrint(data, label, urlPath);
  }

  console.log('\n' + HR);
  console.log('  ✅ Аналіз завершено');
  console.log(HR);
}

main().catch(err => { console.error('ПОМИЛКА:', err.message); process.exit(1); });
