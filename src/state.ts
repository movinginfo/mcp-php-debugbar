import { CapturedRequest, ConnectionConfig, ServerState } from './debugbar/types.js';
import { config } from './config.js';
import { log } from './logger.js';

class State {
  private _state: ServerState = {
    connected: false,
    config: null,
    requests: [],
    maxRequests: config.server.maxRequests,
    chromeConnected: false,
    lastError: null,
  };

  get connected(): boolean {
    return this._state.connected;
  }

  get connectionConfig(): ConnectionConfig | null {
    return this._state.config;
  }

  get requests(): CapturedRequest[] {
    return [...this._state.requests];
  }

  get maxRequests(): number {
    return this._state.maxRequests;
  }

  get chromeConnected(): boolean {
    return this._state.chromeConnected;
  }

  get lastError(): string | null {
    return this._state.lastError;
  }

  connect(cfg: ConnectionConfig): void {
    this._state.connected = true;
    this._state.config = cfg;
    this._state.lastError = null;
    log.info(`Connected to ${cfg.baseUrl} (type: ${cfg.type})`);
  }

  disconnect(): void {
    this._state.connected = false;
    this._state.config = null;
    this._state.chromeConnected = false;
    log.info('Disconnected from PHP server');
  }

  setError(error: string): void {
    this._state.lastError = error;
    log.error(error);
  }

  setChromeConnected(connected: boolean): void {
    this._state.chromeConnected = connected;
  }

  addRequest(req: CapturedRequest): void {
    // Deduplicate by ID
    const existingIdx = this._state.requests.findIndex(r => r.id === req.id);
    if (existingIdx !== -1) {
      // Update existing (might now have data)
      this._state.requests[existingIdx] = req;
      return;
    }

    this._state.requests.unshift(req);

    // Evict oldest if over limit
    if (this._state.requests.length > this._state.maxRequests) {
      this._state.requests = this._state.requests.slice(0, this._state.maxRequests);
    }
  }

  addRequests(requests: CapturedRequest[]): void {
    for (const req of requests) {
      this.addRequest(req);
    }
    // Re-sort by utime descending after bulk add
    this._state.requests.sort((a, b) => b.utime - a.utime);
  }

  getRequest(id: string): CapturedRequest | undefined {
    return this._state.requests.find(r => r.id === id);
  }

  getLatestRequest(): CapturedRequest | undefined {
    return this._state.requests[0];
  }

  clearRequests(): void {
    this._state.requests = [];
    log.info('Cleared all captured requests');
  }

  toSummary(): string {
    const cfg = this._state.config;
    return [
      `Connected: ${this._state.connected}`,
      cfg ? `Server: ${cfg.baseUrl} (${cfg.type})` : 'Server: not configured',
      `Chrome monitor: ${this._state.chromeConnected ? 'active' : 'inactive'}`,
      `Captured requests: ${this._state.requests.length}`,
      this._state.lastError ? `Last error: ${this._state.lastError}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

export const state = new State();
