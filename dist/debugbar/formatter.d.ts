import { CapturedRequest, DebugBarData } from './types.js';
export declare function formatRequestList(requests: CapturedRequest[]): string;
export declare function formatRequestSummary(req: CapturedRequest): string;
export declare function formatQueries(data: DebugBarData, limit?: number): string;
export declare function formatDuplicateQueries(data: DebugBarData): string;
export declare function formatLogs(data: DebugBarData, levelFilter?: string): string;
export declare function formatExceptions(data: DebugBarData): string;
export declare function formatTimeline(data: DebugBarData): string;
export declare function formatRoute(data: DebugBarData): string;
export declare function formatViews(data: DebugBarData): string;
export declare function formatEvents(data: DebugBarData): string;
export declare function formatAuth(data: DebugBarData): string;
export declare function formatModels(data: DebugBarData): string;
export declare function formatCache(data: DebugBarData): string;
export declare function formatSession(data: DebugBarData): string;
export declare function formatFullReport(req: CapturedRequest): string;
//# sourceMappingURL=formatter.d.ts.map