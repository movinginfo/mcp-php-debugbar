/**
 * Source-code-aware debugging tools.
 *
 * These tools bridge DebugBar runtime data with the actual PHP source files:
 *   debugbar_read_source   — read a file around a specific line (from stack traces)
 *   debugbar_fix_issue     — combine DebugBar analysis with source context → actionable fix
 *   debugbar_auto_debug    — one-shot: fetch latest request, analyze, read all implicated
 *                            source files, return complete developer report with code fixes
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { state } from '../state.js';
import { fetchRequestData, fetchRequestList } from '../debugbar/client.js';
import { analyzeRequest, analyzeAll } from '../analyzer/index.js';
import { config } from '../config.js';
// ─── Helpers ──────────────────────────────────────────────────────────────
/**
 * Resolve a file path that may come from PHP stack traces.
 * Stack traces can contain absolute paths (Linux/Windows), or
 * paths relative to the project root.
 */
function resolveSourceFile(filePath, projectRoot) {
    if (!filePath)
        return null;
    // Direct absolute path — check as-is first
    if (fs.existsSync(filePath))
        return filePath;
    if (!projectRoot)
        return null;
    // Try joining with project root (handles Linux paths in Windows project)
    const basename = filePath.replace(/\\/g, '/');
    const candidates = [];
    // Strip leading slash and join
    candidates.push(path.join(projectRoot, basename.replace(/^\//, '')));
    // Try stripping common prefixes like /var/www/html/, /app/, /srv/
    const stripped = basename.replace(/^\/(var\/www\/html|app|srv|home\/\w+\/\w+)\/?/, '');
    if (stripped !== basename) {
        candidates.push(path.join(projectRoot, stripped));
    }
    // Try just the filename portion within project root (recursive search fallback)
    const filename = path.basename(filePath);
    candidates.push(path.join(projectRoot, 'public', filename));
    candidates.push(path.join(projectRoot, 'src', filename));
    candidates.push(path.join(projectRoot, filename));
    for (const c of candidates) {
        if (fs.existsSync(c))
            return c;
    }
    return null;
}
/**
 * Read lines from a file, returning context around a target line.
 */
function readFileContext(filePath, targetLine, contextLines = 10) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const all = raw.split('\n');
        const start = Math.max(0, targetLine - contextLines - 1);
        const end = Math.min(all.length, targetLine + contextLines);
        const lines = all.slice(start, end);
        const numbered = lines.map((l, i) => {
            const lineNo = start + i + 1;
            const marker = lineNo === targetLine ? '>>>' : '   ';
            return `${marker} ${String(lineNo).padStart(4)} | ${l}`;
        });
        return { lines: numbered, startLine: start + 1, content: numbered.join('\n') };
    }
    catch {
        return null;
    }
}
/**
 * Read an entire PHP file (up to maxLines).
 */
function readFullFile(filePath, maxLines = 300) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const lines = raw.split('\n');
        const slice = lines.slice(0, maxLines);
        const numbered = slice.map((l, i) => `${String(i + 1).padStart(4)} | ${l}`);
        if (lines.length > maxLines) {
            numbered.push(`... (${lines.length - maxLines} more lines)`);
        }
        return numbered.join('\n');
    }
    catch {
        return null;
    }
}
// ─── Tool registrations ───────────────────────────────────────────────────
export function registerSourceTools(server) {
    // ── debugbar_read_source ──────────────────────────────────────────────
    server.tool('debugbar_read_source', [
        'Read a PHP source file from the project, optionally focusing on a specific line.',
        'File paths are resolved against PROJECT_ROOT in .env.',
        'Pass a file path from an exception stack trace or query backtrace to see the exact code.',
    ].join(' '), {
        file: z.string().describe('File path (absolute or relative to project root)'),
        line: z.number().optional().describe('Target line number to focus on'),
        context: z
            .number()
            .optional()
            .describe('Lines of context around the target line. Default: 15'),
        full: z
            .boolean()
            .optional()
            .describe('Read the full file instead of a context window. Default: false'),
    }, async ({ file, line, context = 15, full = false }) => {
        const projectRoot = config.projectRoot;
        const resolved = resolveSourceFile(file, projectRoot);
        if (!resolved) {
            const hint = projectRoot
                ? `PROJECT_ROOT is set to: ${projectRoot}`
                : 'Set PROJECT_ROOT in .env to the absolute path of your PHP project.';
            return {
                content: [{
                        type: 'text',
                        text: [
                            `❌ Cannot find file: ${file}`,
                            '',
                            hint,
                            '',
                            'Tips:',
                            '  • Use the exact path from an exception stack trace',
                            '  • Or a path relative to your project root',
                        ].join('\n'),
                    }],
            };
        }
        const HR = '═'.repeat(60);
        const lines = [HR, `FILE: ${resolved}`, HR, ''];
        if (full || !line) {
            const content = readFullFile(resolved, 500);
            if (!content) {
                return { content: [{ type: 'text', text: `❌ Could not read file: ${resolved}` }] };
            }
            lines.push(content);
        }
        else {
            lines.push(`Showing lines around line ${line} (±${context}):`);
            lines.push('');
            const ctx = readFileContext(resolved, line, context);
            if (!ctx) {
                return { content: [{ type: 'text', text: `❌ Could not read file: ${resolved}` }] };
            }
            lines.push(ctx.content);
            lines.push('');
            lines.push(`>>> marks line ${line} (the target)`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    });
    // ── debugbar_fix_issue ────────────────────────────────────────────────
    server.tool('debugbar_fix_issue', [
        'Analyze a specific issue (exception, N+1, slow query) from a DebugBar request,',
        'read the implicated PHP source file, and return the exact problematic code with',
        'a concrete fix. This is the primary tool for AI-driven bug fixing.',
    ].join(' '), {
        id: z
            .string()
            .optional()
            .describe('Request ID. Uses most recent if omitted.'),
        issue_index: z
            .number()
            .optional()
            .describe('Issue number from debugbar_analyze output (1-based). Default: 1 (most critical)'),
    }, async ({ id, issue_index = 1 }) => {
        if (!state.connected || !state.connectionConfig) {
            return {
                content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
            };
        }
        let req = id ? state.getRequest(id) : state.getLatestRequest();
        if (!req) {
            return { content: [{ type: 'text', text: '❌ No requests found. Run debugbar_refresh_requests.' }] };
        }
        if (!req.data) {
            try {
                const data = await fetchRequestData(state.connectionConfig, req.id);
                req = { ...req, data };
                state.addRequest(req);
            }
            catch (err) {
                return {
                    content: [{ type: 'text', text: `❌ ${err instanceof Error ? err.message : err}` }],
                };
            }
        }
        const analysis = analyzeRequest(req);
        if (!analysis) {
            return { content: [{ type: 'text', text: '❌ Could not analyze request.' }] };
        }
        if (analysis.issues.length === 0) {
            return {
                content: [{
                        type: 'text',
                        text: `✅ No issues found in ${req.method} ${req.uri} (score: ${analysis.score}/100)`,
                    }],
            };
        }
        const idx = Math.min(issue_index - 1, analysis.issues.length - 1);
        const issue = analysis.issues[idx];
        const projectRoot = config.projectRoot;
        const HR = '═'.repeat(64);
        const SEP = '─'.repeat(64);
        const lines = [
            HR,
            `🔧 FIX: [${issue.severity.toUpperCase()}] ${issue.title}`,
            `   Request: ${req.method} ${req.uri} | ID: ${req.id}`,
            HR,
            '',
            `Category : ${issue.category}`,
            `Severity : ${issue.severity}`,
            '',
            `Problem:`,
            `  ${issue.description.split('\n').join('\n  ')}`,
            '',
        ];
        // Read source file if available
        if (issue.file) {
            const resolved = resolveSourceFile(issue.file, projectRoot);
            lines.push(SEP);
            lines.push(`📍 SOURCE FILE: ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
            if (resolved) {
                lines.push(`   (resolved: ${resolved})`);
                lines.push('');
                if (issue.line) {
                    const ctx = readFileContext(resolved, issue.line, 12);
                    if (ctx) {
                        lines.push(`Code context (>>> marks the problem line):`);
                        lines.push('');
                        lines.push(ctx.content);
                    }
                }
                else {
                    const full = readFullFile(resolved, 80);
                    if (full) {
                        lines.push('File content:');
                        lines.push('');
                        lines.push(full);
                    }
                }
            }
            else {
                lines.push('');
                lines.push(`⚠️  File not found in project root.`);
                if (projectRoot) {
                    lines.push(`   PROJECT_ROOT: ${projectRoot}`);
                }
                else {
                    lines.push(`   Set PROJECT_ROOT in .env to enable source reading.`);
                }
            }
            lines.push('');
        }
        // Fix suggestion
        lines.push(SEP);
        lines.push('💡 HOW TO FIX:');
        lines.push('');
        issue.suggestion.split('\n').forEach(l => lines.push(`  ${l}`));
        // SQL for query issues
        if (issue.sql) {
            lines.push('');
            lines.push(SEP);
            lines.push('🗄️  PROBLEMATIC SQL:');
            lines.push('');
            lines.push(`  ${issue.sql.slice(0, 500)}`);
        }
        // Other issues in this request
        if (analysis.issues.length > 1) {
            lines.push('');
            lines.push(SEP);
            lines.push(`Other issues in this request (${analysis.issues.length - 1} more):`);
            analysis.issues.forEach((iss, i) => {
                if (i === idx)
                    return;
                const icon = iss.severity === 'critical' ? '🔴' : iss.severity === 'warning' ? '🟡' : 'ℹ️';
                lines.push(`  ${i + 1}. ${icon} ${iss.title}${iss.file ? ` — ${iss.file}${iss.line ? ':' + iss.line : ''}` : ''}`);
            });
            lines.push('');
            lines.push(`Use debugbar_fix_issue with issue_index=N to fix each one.`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    });
    // ── debugbar_auto_debug ───────────────────────────────────────────────
    server.tool('debugbar_auto_debug', [
        'ONE-SHOT DEBUGGING TOOL. Fetches the latest request (or specified URL), loads full',
        'DebugBar data, runs analysis, reads ALL implicated PHP source files, and returns a',
        'complete developer report: every issue with exact code location, code context, and',
        'concrete fix. This is what you call to debug a PHP app — no manual steps needed.',
    ].join(' '), {
        url: z
            .string()
            .optional()
            .describe('Fetch this URL path first (e.g. /users or /api/products). If omitted, uses the latest captured request.'),
        id: z
            .string()
            .optional()
            .describe('Use this specific request ID instead of the latest.'),
        all: z
            .boolean()
            .optional()
            .describe('Analyze ALL cached requests and produce a full project health report. Default: false'),
        refresh: z
            .boolean()
            .optional()
            .describe('Refresh request list from server before analyzing. Default: true'),
    }, async ({ url, id, all = false, refresh = true }) => {
        if (!state.connected || !state.connectionConfig) {
            return {
                content: [{ type: 'text', text: '❌ Not connected. Run debugbar_connect first.' }],
            };
        }
        const cfg = state.connectionConfig;
        const projectRoot = config.projectRoot;
        // Optionally fetch a specific URL
        if (url) {
            try {
                const { makeTrackedRequest } = await import('../debugbar/client.js');
                const result = await makeTrackedRequest(cfg, url, 'GET', {});
                if (result.debugbarId) {
                    const req = {
                        id: result.debugbarId,
                        datetime: new Date().toISOString().replace('T', ' ').slice(0, 19),
                        utime: Date.now() / 1000,
                        method: 'GET',
                        uri: url,
                        ip: '127.0.0.1',
                        capturedAt: new Date(),
                        source: 'manual',
                        statusCode: result.statusCode,
                        data: result.data,
                    };
                    state.addRequest(req);
                }
            }
            catch (err) {
                return {
                    content: [{
                            type: 'text',
                            text: `❌ Failed to fetch ${url}: ${err instanceof Error ? err.message : err}`,
                        }],
                };
            }
        }
        // Refresh from server
        if (refresh && !url) {
            try {
                const fresh = await fetchRequestList(cfg, 25, 0);
                state.addRequests(fresh);
            }
            catch {
                // Non-fatal; continue with cached
            }
        }
        const HR = '═'.repeat(70);
        const SEP = '─'.repeat(70);
        // ─ ALL requests mode ──────────────────────────────────────────────
        if (all) {
            // Load data for any requests that don't have it yet (up to 10)
            const unloaded = state.requests.filter(r => !r.data).slice(0, 10);
            await Promise.all(unloaded.map(async (r) => {
                try {
                    const data = await fetchRequestData(cfg, r.id);
                    state.addRequest({ ...r, data });
                }
                catch {
                    // skip
                }
            }));
            const results = analyzeAll(state.requests);
            if (results.length === 0) {
                return {
                    content: [{ type: 'text', text: '❌ No analyzed data available. Browse the PHP app first.' }],
                };
            }
            const totalIssues = results.reduce((s, r) => s + r.issues.length, 0);
            const critical = results.reduce((s, r) => s + r.issues.filter(i => i.severity === 'critical').length, 0);
            const avgScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
            const lines = [
                HR,
                `🔍 PROJECT HEALTH REPORT — ${results.length} requests analyzed`,
                HR,
                '',
                `Overall health: ${avgScore}/100 | ${critical} critical issue(s) | ${totalIssues} total`,
                '',
                SEP,
            ];
            for (const result of results.sort((a, b) => a.score - b.score)) {
                lines.push(`${result.summary}`);
                lines.push('');
                for (const issue of result.issues) {
                    const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️';
                    lines.push(`  ${icon} ${issue.title}`);
                    if (issue.file) {
                        const resolved = resolveSourceFile(issue.file, projectRoot);
                        const filePart = resolved ? path.relative(projectRoot, resolved) : issue.file;
                        lines.push(`     📍 ${filePart}${issue.line ? ':' + issue.line : ''}`);
                        if (resolved && issue.line) {
                            const ctx = readFileContext(resolved, issue.line, 3);
                            if (ctx) {
                                lines.push('');
                                lines.push(ctx.content.split('\n').map(l => '     ' + l).join('\n'));
                            }
                        }
                    }
                    lines.push(`     💡 ${issue.suggestion.split('\n')[0]}`);
                    lines.push('');
                }
                lines.push(SEP);
            }
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        // ─ Single request mode ────────────────────────────────────────────
        let req = id ? state.getRequest(id) : state.getLatestRequest();
        if (!req) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ No requests found. Browse your PHP app or use the url parameter.',
                    }],
            };
        }
        if (!req.data) {
            try {
                const data = await fetchRequestData(cfg, req.id);
                req = { ...req, data };
                state.addRequest(req);
            }
            catch (err) {
                return {
                    content: [{
                            type: 'text',
                            text: `❌ Cannot load data: ${err instanceof Error ? err.message : err}`,
                        }],
                };
            }
        }
        const analysis = analyzeRequest(req);
        if (!analysis) {
            return { content: [{ type: 'text', text: '❌ Could not analyze request data.' }] };
        }
        const lines = [
            HR,
            `🐛 DEBUG REPORT: ${req.method} ${req.uri}`,
            `   ID: ${req.id} | ${req.datetime}`,
            HR,
            '',
            `Health score : ${analysis.score}/100  ${scoreBar(analysis.score)}`,
            `Duration     : ${req.data?.time?.duration_str ?? '?'}`,
            `Memory       : ${req.data?.memory?.peak_usage_str ?? '?'}`,
            `SQL queries  : ${analysis.stats.totalQueries}${analysis.stats.duplicateQueries ? ` (⚠️ ${analysis.stats.duplicateQueries} duplicate patterns — N+1!)` : ''}`,
            `Exceptions   : ${analysis.stats.exceptions}`,
            `Log messages : ${req.data?.messages?.count ?? 0}`,
            '',
        ];
        if (analysis.issues.length === 0) {
            lines.push('✅ No issues detected. Code looks healthy.');
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        lines.push(`Found ${analysis.issues.length} issue(s) — showing full code context:`);
        lines.push('');
        for (let i = 0; i < analysis.issues.length; i++) {
            const issue = analysis.issues[i];
            const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️';
            lines.push(SEP);
            lines.push(`ISSUE ${i + 1}/${analysis.issues.length}: ${icon} [${issue.category.toUpperCase()}] ${issue.title}`);
            lines.push(SEP);
            lines.push('');
            lines.push(`Problem:`);
            lines.push(`  ${issue.description.split('\n').join('\n  ')}`);
            lines.push('');
            // Source code context
            if (issue.file) {
                const resolved = resolveSourceFile(issue.file, projectRoot);
                const displayPath = resolved && projectRoot
                    ? path.relative(projectRoot, resolved)
                    : issue.file;
                lines.push(`📍 Location: ${displayPath}${issue.line ? ':' + issue.line : ''}`);
                if (resolved) {
                    lines.push('');
                    if (issue.line) {
                        const ctx = readFileContext(resolved, issue.line, 10);
                        if (ctx) {
                            lines.push(`Code (>>> = problem line):`);
                            lines.push('');
                            lines.push(ctx.content);
                        }
                    }
                    else {
                        const full = readFullFile(resolved, 60);
                        if (full) {
                            lines.push(`File content (first 60 lines):`);
                            lines.push('');
                            lines.push(full);
                        }
                    }
                }
                else {
                    lines.push(`   ⚠️  File not found on disk.`);
                    if (!projectRoot) {
                        lines.push(`   Set PROJECT_ROOT in .env (currently not set).`);
                    }
                }
                lines.push('');
            }
            // SQL
            if (issue.sql) {
                lines.push(`🗄️  SQL:`);
                lines.push(`  ${issue.sql.slice(0, 400)}`);
                lines.push('');
            }
            // Fix
            lines.push(`💡 FIX:`);
            issue.suggestion.split('\n').forEach(l => lines.push(`  ${l}`));
            lines.push('');
        }
        // Logs
        if (req.data?.messages?.count) {
            lines.push(SEP);
            lines.push(`📋 LOG MESSAGES (${req.data.messages.count}):`);
            lines.push('');
            const labelIcon = { error: '🔴', warning: '🟡', info: '🔵', debug: '⚪' };
            req.data.messages.messages.slice(0, 20).forEach((m, idx) => {
                const icon = labelIcon[m.label?.toLowerCase() ?? ''] ?? '▸';
                const body = typeof m.message === 'string' ? m.message : JSON.stringify(m.message);
                lines.push(`  ${icon} [${(m.label ?? 'debug').toUpperCase()}] ${body.slice(0, 300)}`);
            });
            lines.push('');
        }
        lines.push(SEP);
        lines.push('QUICK ACTIONS:');
        analysis.quickFixes.forEach((fix, i) => lines.push(`  ${i + 1}. ${fix}`));
        if (projectRoot) {
            lines.push('');
            lines.push(`Project root: ${projectRoot}`);
            lines.push(`Use debugbar_read_source with the file paths above to see more code.`);
            lines.push(`Use debugbar_fix_issue with issue_index=N to focus on a specific fix.`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    });
}
function scoreBar(score) {
    const filled = Math.round(score / 10);
    return '[' + '█'.repeat(filled) + '░'.repeat(10 - filled) + ']';
}
//# sourceMappingURL=source.js.map