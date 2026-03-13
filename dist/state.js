import { config } from './config.js';
import { log } from './logger.js';
class State {
    _state = {
        connected: false,
        config: null,
        requests: [],
        maxRequests: config.server.maxRequests,
        chromeConnected: false,
        lastError: null,
    };
    get connected() {
        return this._state.connected;
    }
    get connectionConfig() {
        return this._state.config;
    }
    get requests() {
        return [...this._state.requests];
    }
    get maxRequests() {
        return this._state.maxRequests;
    }
    get chromeConnected() {
        return this._state.chromeConnected;
    }
    get lastError() {
        return this._state.lastError;
    }
    connect(cfg) {
        this._state.connected = true;
        this._state.config = cfg;
        this._state.lastError = null;
        log.info(`Connected to ${cfg.baseUrl} (type: ${cfg.type})`);
    }
    disconnect() {
        this._state.connected = false;
        this._state.config = null;
        this._state.chromeConnected = false;
        log.info('Disconnected from PHP server');
    }
    setError(error) {
        this._state.lastError = error;
        log.error(error);
    }
    setChromeConnected(connected) {
        this._state.chromeConnected = connected;
    }
    addRequest(req) {
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
    addRequests(requests) {
        for (const req of requests) {
            this.addRequest(req);
        }
        // Re-sort by utime descending after bulk add
        this._state.requests.sort((a, b) => b.utime - a.utime);
    }
    getRequest(id) {
        return this._state.requests.find(r => r.id === id);
    }
    getLatestRequest() {
        return this._state.requests[0];
    }
    clearRequests() {
        this._state.requests = [];
        log.info('Cleared all captured requests');
    }
    toSummary() {
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
//# sourceMappingURL=state.js.map