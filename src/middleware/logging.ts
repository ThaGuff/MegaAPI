import type { Context, Next } from 'hono';

// ─── In-memory log ring buffer ────────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  method:    string;
  path:      string;
  status:    number;
  duration:  number;
  ip:        string;
  error?:    string;
}

const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];

export function getRecentLogs(limit = 100): LogEntry[] {
  return logBuffer.slice(-limit).reverse();
}

// ─── Performance metrics ──────────────────────────────────────────────────────

interface Metrics {
  requests_total:    number;
  requests_success:  number;
  requests_error:    number;
  avg_duration_ms:   number;
  p95_duration_ms:   number;
  uptime_seconds:    number;
  started_at:        string;
}

const startedAt = new Date();
let totalRequests = 0;
let successRequests = 0;
let errorRequests = 0;
const durations: number[] = [];

export function getMetrics(): Metrics {
  const sorted = [...durations].sort((a, b) => a - b);
  const p95Idx = Math.floor(sorted.length * 0.95);

  return {
    requests_total:   totalRequests,
    requests_success: successRequests,
    requests_error:   errorRequests,
    avg_duration_ms:  durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    p95_duration_ms:  sorted[p95Idx] || 0,
    uptime_seconds:   Math.floor((Date.now() - startedAt.getTime()) / 1000),
    started_at:       startedAt.toISOString(),
  };
}

// ─── Logging middleware ───────────────────────────────────────────────────────

export function requestLogger() {
  return async (c: Context, next: Next) => {
    const start  = Date.now();
    const method = c.req.method;
    const path   = new URL(c.req.url).pathname;
    const ip     = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

    await next();

    const duration = Date.now() - start;
    const status   = c.res.status;

    // Update metrics
    totalRequests++;
    if (status < 400) successRequests++;
    else errorRequests++;

    // Keep last 1000 durations for percentile calculation
    durations.push(duration);
    if (durations.length > 1000) durations.shift();

    // Log entry
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      method,
      path,
      status,
      duration,
      ip,
    };

    // Add to ring buffer
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();

    // Console output
    const statusColor = status < 300 ? '\x1b[32m' : status < 400 ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(
      `${statusColor}${status}${reset} ${method.padEnd(6)} ${path.padEnd(40)} ${duration}ms`,
    );
  };
}
