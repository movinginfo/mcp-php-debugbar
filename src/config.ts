import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from project root (allow missing file)
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function getEnvNumber(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const num = parseInt(val, 10);
  return isNaN(num) ? fallback : num;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val.toLowerCase() === 'true' || val === '1';
}

export const config = {
  debugbar: {
    baseUrl: getEnv('DEBUGBAR_BASE_URL', ''),
    openHandlerPath: getEnv('DEBUGBAR_OPEN_HANDLER', '/_debugbar/open'),
    type: getEnv('DEBUGBAR_TYPE', 'auto') as 'laravel' | 'php' | 'auto',
    timeout: getEnvNumber('REQUEST_TIMEOUT', 10000),
  },
  chrome: {
    host: getEnv('CHROME_HOST', 'localhost'),
    port: getEnvNumber('CHROME_PORT', 9222),
    autoConnect: getEnvBool('CHROME_AUTO_CONNECT', false),
  },
  server: {
    maxRequests: getEnvNumber('MAX_REQUESTS', 100),
    logLevel: getEnv('LOG_LEVEL', 'info'),
  },
  /** Absolute path to the PHP project root. Used to read source files. */
  projectRoot: getEnv('PROJECT_ROOT', ''),
} as const;

export type Config = typeof config;
