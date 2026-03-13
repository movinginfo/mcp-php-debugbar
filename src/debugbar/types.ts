// ─── PHP DebugBar core data types ─────────────────────────────────────────

export interface DebugBarMeta {
  id: string;
  datetime: string;
  utime: number;
  method: string;
  uri: string;
  ip: string;
}

export interface DebugBarMessage {
  message: string | object;
  label: string;
  time: number;
  collector?: string;
  is_string?: boolean;
  message_html?: string;
}

export interface DebugBarMessages {
  count: number;
  messages: DebugBarMessage[];
}

export interface DebugBarMeasure {
  label: string;
  start: number;
  end: number;
  relative_start: number;
  duration: number;
  duration_str: string;
  params: Record<string, unknown>;
  collector?: string;
}

export interface DebugBarTime {
  start: number;
  end: number;
  duration: number;
  duration_str: string;
  measures: DebugBarMeasure[];
}

export interface DebugBarMemory {
  peak_usage: number;
  peak_usage_str: string;
}

export interface DebugBarStackFrame {
  file: string;
  line: number;
  function?: string;
  class?: string;
  type?: string;
  args?: unknown[];
  namespace?: string;
}

export interface DebugBarException {
  type: string;
  message: string;
  code: number;
  file: string;
  line: number;
  collector?: string;
  stack?: DebugBarStackFrame[];
  surrounding_lines?: string[];
  occurrences?: number;
}

export interface DebugBarExceptions {
  count: number;
  exceptions: DebugBarException[];
}

export interface DebugBarStatement {
  sql: string;
  type: string;
  duration: number;
  duration_str: string;
  stmt_id?: string;
  is_success: boolean;
  error_code?: number;
  error_message?: string;
  backtrace?: DebugBarStackFrame[];
  bindings?: unknown[];
  row_count?: number;
  memory?: number;
  memory_str?: string;
  connection?: string;
  driver?: string;
  hash?: string;
  explain?: DebugBarExplainRow[];
}

export interface DebugBarExplainRow {
  id: number;
  select_type: string;
  table: string;
  type: string;
  possible_keys: string | null;
  key: string | null;
  key_len: string | null;
  ref: string | null;
  rows: number;
  extra: string;
}

export interface DebugBarPdo {
  nb_statements: number;
  nb_failed_statements: number;
  accumulated_duration: number;
  accumulated_duration_str: string;
  memory_usage: number;
  memory_usage_str: string;
  statements: DebugBarStatement[];
}

// ─── Laravel-specific collector types ─────────────────────────────────────

export interface LaravelRoute {
  uri: string;
  method: string[];
  action: string;
  as?: string;
  middleware: string[];
  prefix?: string;
  namespace?: string;
  file?: string;
  line?: number;
  uses?: string;
  wheres?: Record<string, string>;
}

export interface LaravelView {
  name: string;
  rendered: number;
  params?: Record<string, unknown>;
  type?: string;
  param_count?: number;
}

export interface LaravelViews {
  nb_templates: number;
  templates: LaravelView[];
}

export interface LaravelEvent {
  event: string;
  listeners?: string[];
  data?: unknown[];
  caller?: DebugBarStackFrame;
  time?: number;
}

export interface LaravelEvents {
  count: number;
  events: LaravelEvent[];
}

export interface LaravelGuard {
  name: string;
  label: string;
  is_authenticated: boolean;
  is_impersonating?: boolean;
  token?: string;
  user?: Record<string, unknown>;
}

export interface LaravelAuth {
  guards: LaravelGuard[];
}

export interface LaravelGateMeasure {
  label: string;
  value: boolean;
  caller?: string;
  user?: string | null;
  type: string;
  result?: string;
}

export interface LaravelGate {
  count: number;
  measures: LaravelGateMeasure[];
}

export interface LaravelModel {
  action: string;
  model: string;
  count?: number;
}

export interface LaravelModels {
  count: number;
  models: LaravelModel[];
}

export interface LaravelCacheMeasure {
  label: string;
  value: unknown;
  caller?: string;
  duration?: string;
  type: string;
  key?: string;
  tags?: string[];
}

export interface LaravelCache {
  count: number;
  measures: LaravelCacheMeasure[];
}

export interface LaravelInfo {
  laravel_version: string;
  php_version: string;
  environment: string;
  debug: boolean;
  locale?: string;
  timezone?: string;
  with_stack?: boolean;
}

export interface LaravelSessionData {
  key: string;
  value: unknown;
  type: string;
}

export interface LaravelSession {
  count: number;
  data: LaravelSessionData[];
}

export interface LaravelMail {
  count: number;
  messages: {
    to: string[];
    subject: string;
    from?: string;
    cc?: string[];
    bcc?: string[];
    time?: string;
  }[];
}

export interface LaravelJob {
  id?: string;
  name: string;
  queue?: string;
  connection?: string;
  status?: string;
  time?: number;
  time_str?: string;
  data?: Record<string, unknown>;
}

export interface LaravelJobs {
  count: number;
  jobs: LaravelJob[];
}

// ─── Main DebugBar data structure ─────────────────────────────────────────

export interface DebugBarData {
  __meta: DebugBarMeta;
  messages?: DebugBarMessages;
  time?: DebugBarTime;
  memory?: DebugBarMemory;
  exceptions?: DebugBarExceptions;
  pdo?: DebugBarPdo;
  // Laravel collectors
  route?: LaravelRoute;
  views?: LaravelViews;
  events?: LaravelEvents;
  auth?: LaravelAuth;
  gate?: LaravelGate;
  models?: LaravelModels;
  cache?: LaravelCache;
  laravel?: LaravelInfo;
  session?: LaravelSession | Record<string, unknown>;
  config?: Record<string, unknown>;
  mail?: LaravelMail;
  jobs?: LaravelJobs;
  livewire?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Captured request wrapper ──────────────────────────────────────────────

export interface CapturedRequest {
  id: string;
  datetime: string;
  utime: number;
  method: string;
  uri: string;
  ip: string;
  capturedAt: Date;
  source: 'chrome' | 'manual' | 'polling' | 'storage';
  statusCode?: number;
  data?: DebugBarData;
}

// ─── Connection configuration ─────────────────────────────────────────────

export type ProjectType = 'laravel' | 'php' | 'auto';

export interface ConnectionConfig {
  baseUrl: string;
  openHandlerPath: string;
  type: ProjectType;
  chromePort?: number;
  chromeHost?: string;
  timeout: number;
}

export interface ServerState {
  connected: boolean;
  config: ConnectionConfig | null;
  requests: CapturedRequest[];
  maxRequests: number;
  chromeConnected: boolean;
  lastError: string | null;
}
