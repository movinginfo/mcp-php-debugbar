import { CapturedRequest, ConnectionConfig, DebugBarData } from './types.js';
export declare function detectProjectType(baseUrl: string, timeout: number): Promise<'laravel' | 'php'>;
export declare function fetchRequestList(cfg: ConnectionConfig, max?: number, offset?: number): Promise<CapturedRequest[]>;
export declare function fetchRequestData(cfg: ConnectionConfig, id: string): Promise<DebugBarData>;
export interface TrackedRequestResult {
    statusCode: number;
    headers: Record<string, string>;
    debugbarId: string | null;
    data?: DebugBarData;
}
export declare function makeTrackedRequest(cfg: ConnectionConfig, path: string, method?: string, customHeaders?: Record<string, string>, body?: unknown): Promise<TrackedRequestResult>;
export declare function probeServer(baseUrl: string, timeout: number): Promise<boolean>;
//# sourceMappingURL=client.d.ts.map