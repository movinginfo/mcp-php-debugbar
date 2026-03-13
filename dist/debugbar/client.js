import axios from 'axios';
import { log } from '../logger.js';
// ─── Client factory ────────────────────────────────────────────────────────
function buildAxios(baseUrl, timeout) {
    return axios.create({
        baseURL: baseUrl.replace(/\/$/, ''),
        timeout,
        headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'mcp-php-debugbar/1.0',
        },
    });
}
// ─── Detect project type by probing the server ────────────────────────────
export async function detectProjectType(baseUrl, timeout) {
    const http = buildAxios(baseUrl, timeout);
    try {
        const res = await http.get('/_debugbar/open', {
            params: { max: 1, offset: 0 },
        });
        if (res.status === 200) {
            log.info('Detected project type: laravel');
            return 'laravel';
        }
    }
    catch {
        // fall through
    }
    log.info('Detected project type: php (vanilla)');
    return 'php';
}
// ─── Fetch list of recent requests ────────────────────────────────────────
export async function fetchRequestList(cfg, max = 25, offset = 0) {
    const http = buildAxios(cfg.baseUrl, cfg.timeout);
    const url = cfg.openHandlerPath;
    log.debug(`Fetching request list from ${url}?max=${max}&offset=${offset}`);
    let res;
    try {
        res = await http.get(url, {
            params: { max, offset },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch request list: ${msg}`);
    }
    const items = Array.isArray(res.data) ? res.data : [];
    return items.map((item) => ({
        id: item.id,
        datetime: item.datetime,
        utime: item.utime,
        method: item.method,
        uri: item.uri,
        ip: item.ip,
        capturedAt: new Date(),
        source: 'polling',
    }));
}
// ─── Fetch full data for a single request ─────────────────────────────────
export async function fetchRequestData(cfg, id) {
    const http = buildAxios(cfg.baseUrl, cfg.timeout);
    const url = cfg.openHandlerPath;
    log.debug(`Fetching request data for id=${id}`);
    let res;
    try {
        res = await http.get(url, {
            params: { id },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch request data (id=${id}): ${msg}`);
    }
    const data = res.data;
    if (!data || typeof data !== 'object') {
        throw new Error(`Invalid debugbar data response for id=${id}`);
    }
    return data;
}
export async function makeTrackedRequest(cfg, path, method = 'GET', customHeaders = {}, body) {
    const http = buildAxios(cfg.baseUrl, cfg.timeout);
    log.debug(`Making tracked request: ${method} ${path}`);
    let res;
    try {
        res = await http.request({
            url: path,
            method: method,
            headers: customHeaders,
            data: body,
            validateStatus: () => true, // don't throw on non-2xx
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Tracked request failed: ${msg}`);
    }
    const responseHeaders = res.headers;
    const rawId = responseHeaders['phpdebugbar-id'] ||
        responseHeaders['x-debugbar-id'] ||
        responseHeaders['X-Debugbar-Id'] ||
        null;
    const debugbarId = rawId ?? null;
    log.debug(`Response status=${res.status}, phpdebugbar-id=${debugbarId ?? 'none'}`);
    const result = {
        statusCode: res.status,
        headers: responseHeaders,
        debugbarId,
    };
    // Immediately fetch full debug data if we have an ID
    if (debugbarId) {
        try {
            result.data = await fetchRequestData(cfg, debugbarId);
        }
        catch (err) {
            log.warn(`Could not fetch debugbar data for id=${debugbarId}: ${err}`);
        }
    }
    return result;
}
// ─── Probe connectivity ───────────────────────────────────────────────────
export async function probeServer(baseUrl, timeout) {
    const http = buildAxios(baseUrl, timeout);
    try {
        await http.get('/', { validateStatus: () => true, timeout: Math.min(timeout, 5000) });
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=client.js.map