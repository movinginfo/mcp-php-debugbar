/**
 * Cursor IDE — specific MCP tools.
 *
 * These tools close the loop between:
 *   Cursor editor ←→ PHP DebugBar data ←→ AI assistant
 *
 * Key workflows:
 *   1. debugbar_open_preview     — gives exact commands to open a browser preview
 *   2. debugbar_start_polling    — poll for new requests (no CDP needed)
 *   3. debugbar_stop_polling     — stop polling
 *   4. debugbar_auto_analyze     — analyze latest request and return fix suggestions
 *   5. debugbar_watch_and_debug  — start monitoring + auto-analyze each new request
 *   6. debugbar_suggest_fixes    — parse debug data and produce AI-ready fix list
 *   7. debugbar_webhook_start    — start webhook receiver for injected JS mode
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerCursorTools(server: McpServer): void;
//# sourceMappingURL=cursor.d.ts.map