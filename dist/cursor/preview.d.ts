/**
 * Cursor IDE + Chrome Preview Integration
 *
 * How Cursor preview works with PHP DebugBar:
 *
 * OPTION A — Cursor built-in "Simple Browser"
 *   • Cursor's webview (Simple Browser) does NOT expose Chrome DevTools Protocol.
 *   • DebugBar toolbar IS rendered inside the webview (visual only).
 *   • To capture debug data programmatically, use polling mode:
 *     the MCP server polls /_debugbar/open periodically for new requests.
 *
 * OPTION B — Chrome with remote debugging (RECOMMENDED for full CDP support)
 *   • Start Chrome with --remote-debugging-port=9222
 *   • MCP server connects via CDP and automatically captures every request.
 *   • Every page visit → phpdebugbar-id header → instant debug data.
 *
 * OPTION C — VS Code / Cursor "Preview" extension with user script
 *   • Inject a small snippet into the page that POSTs debug IDs to a local
 *     webhook receiver, which the MCP server listens to.
 *
 * This module provides:
 *   - Instructions and launch commands for each mode
 *   - A polling manager for Cursor Simple Browser mode
 *   - Webhook receiver for the injected script mode
 */
import { CapturedRequest } from '../debugbar/types.js';
export interface PreviewMode {
    name: string;
    description: string;
    setupSteps: string[];
    launchCommand?: string;
    proAndCons: {
        pros: string[];
        cons: string[];
    };
}
export declare const PREVIEW_MODES: Record<string, PreviewMode>;
export declare function getLaunchCommands(url: string, cdpPort?: number, browser?: 'chrome' | 'edge' | 'chromium'): {
    windows: string;
    macos: string;
    linux: string;
    cursor: string;
};
export interface PollingManager {
    isRunning: boolean;
    stop: () => void;
    capturedCount: number;
}
export declare function startPolling(intervalMs?: number, onNewRequest?: (req: CapturedRequest) => void): PollingManager;
export interface WebhookServer {
    port: number;
    stop: () => Promise<void>;
}
export declare function startWebhookReceiver(port?: number, onCapture?: (id: string, url: string) => void): Promise<WebhookServer>;
export declare function getInjectableScript(webhookPort?: number): string;
export declare function getPhpInjectSnippet(webhookPort?: number): string;
//# sourceMappingURL=preview.d.ts.map