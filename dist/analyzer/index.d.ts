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
import { CapturedRequest } from '../debugbar/types.js';
export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueCategory = 'n+1' | 'slow-query' | 'failed-query' | 'exception' | 'memory' | 'performance' | 'missing-index' | 'large-response';
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
export interface AnalyzerConfig {
    slowQueryMs: number;
    criticalQueryMs: number;
    memoryWarningMb: number;
    memoryCriticalMb: number;
    slowRequestMs: number;
    criticalRequestMs: number;
    duplicateMinCount: number;
}
export declare function analyzeRequest(req: CapturedRequest, config?: Partial<AnalyzerConfig>): AnalysisResult | null;
export declare function analyzeAll(requests: CapturedRequest[], config?: Partial<AnalyzerConfig>): AnalysisResult[];
export declare function formatAnalysis(result: AnalysisResult): string;
//# sourceMappingURL=index.d.ts.map