import { CapturedRequest, ConnectionConfig } from './debugbar/types.js';
declare class State {
    private _state;
    get connected(): boolean;
    get connectionConfig(): ConnectionConfig | null;
    get requests(): CapturedRequest[];
    get maxRequests(): number;
    get chromeConnected(): boolean;
    get lastError(): string | null;
    connect(cfg: ConnectionConfig): void;
    disconnect(): void;
    setError(error: string): void;
    setChromeConnected(connected: boolean): void;
    addRequest(req: CapturedRequest): void;
    addRequests(requests: CapturedRequest[]): void;
    getRequest(id: string): CapturedRequest | undefined;
    getLatestRequest(): CapturedRequest | undefined;
    clearRequests(): void;
    toSummary(): string;
}
export declare const state: State;
export {};
//# sourceMappingURL=state.d.ts.map