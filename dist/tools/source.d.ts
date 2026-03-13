/**
 * Source-code-aware debugging tools.
 *
 * These tools bridge DebugBar runtime data with the actual PHP source files:
 *   debugbar_read_source   — read a file around a specific line (from stack traces)
 *   debugbar_fix_issue     — combine DebugBar analysis with source context → actionable fix
 *   debugbar_auto_debug    — one-shot: fetch latest request, analyze, read all implicated
 *                            source files, return complete developer report with code fixes
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerSourceTools(server: McpServer): void;
//# sourceMappingURL=source.d.ts.map