// All output goes to stderr so stdout stays clean for MCP JSON-RPC messages

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function getConfiguredLevel(): number {
  const level = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase() as Level;
  return LEVELS[level] ?? LEVELS.info;
}

function write(level: Level, ...args: unknown[]): void {
  if (LEVELS[level] < getConfiguredLevel()) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  process.stderr.write(`${prefix} ${args.map(String).join(' ')}\n`);
}

export const log = {
  debug: (...args: unknown[]) => write('debug', ...args),
  info: (...args: unknown[]) => write('info', ...args),
  warn: (...args: unknown[]) => write('warn', ...args),
  error: (...args: unknown[]) => write('error', ...args),
};
