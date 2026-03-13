// All output goes to stderr so stdout stays clean for MCP JSON-RPC messages
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
function getConfiguredLevel() {
    const level = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
    return LEVELS[level] ?? LEVELS.info;
}
function write(level, ...args) {
    if (LEVELS[level] < getConfiguredLevel())
        return;
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}]`;
    process.stderr.write(`${prefix} ${args.map(String).join(' ')}\n`);
}
export const log = {
    debug: (...args) => write('debug', ...args),
    info: (...args) => write('info', ...args),
    warn: (...args) => write('warn', ...args),
    error: (...args) => write('error', ...args),
};
//# sourceMappingURL=logger.js.map