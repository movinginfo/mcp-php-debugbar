/**
 * Chrome DevTools Protocol (CDP) integration.
 *
 * How it works:
 *  1. Start Chrome with --remote-debugging-port=9222
 *  2. We connect via chrome-remote-interface
 *  3. Enable Network domain to intercept all HTTP responses
 *  4. When a response contains "phpdebugbar-id" or "x-debugbar-id" header,
 *     we fire a callback with the request ID
 *  5. The caller fetches full debugbar data from the PHP server using that ID
 *
 * For Cursor built-in preview: the webview uses Chromium, which exposes
 * DevTools on a configurable port. Use the same chrome port approach.
 */
export interface DebugBarCaptureEvent {
    requestId: string;
    debugbarId: string;
    url: string;
    statusCode: number;
    method: string;
}
export interface ChromeMonitor {
    stop: () => Promise<void>;
    isRunning: boolean;
}
export declare function listChromeTabs(host?: string, port?: number): Promise<{
    id: string;
    url: string;
    title: string;
    type: string;
}[]>;
export declare function pingChrome(host?: string, port?: number): Promise<boolean>;
export declare function getChromeVersion(host?: string, port?: number): Promise<string>;
export declare function startChromeMonitor(host: string, port: number, baseUrl: string, onCapture: (event: DebugBarCaptureEvent) => void): Promise<ChromeMonitor>;
export declare function captureScreenshot(host: string, port: number, url?: string): Promise<string | null>;
//# sourceMappingURL=browser.d.ts.map