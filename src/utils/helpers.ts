import crypto from 'crypto';

// ─── ID generation ────────────────────────────────────────────────────────────

export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Async utilities ──────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < maxAttempts - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw lastError;
}

// ─── Object utilities ─────────────────────────────────────────────────────────

export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) delete result[key];
  return result as Omit<T, K>;
}

export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

export function isNonEmpty<T>(arr: T[]): arr is [T, ...T[]] {
  return arr.length > 0;
}

// ─── Environment helpers ──────────────────────────────────────────────────────

export function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Required environment variable ${key} is not set`);
  return val;
}

export function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export function paginate<T>(
  items: T[],
  page: number,
  limit: number,
): { data: T[]; total: number; page: number; limit: number; has_more: boolean } {
  const total   = items.length;
  const start   = (page - 1) * limit;
  const data    = items.slice(start, start + limit);
  const has_more = start + limit < total;
  return { data, total, page, limit, has_more };
}

// ─── Rate limiting (simple in-memory) ────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count++;
  const remaining = Math.max(0, maxRequests - entry.count);
  return {
    allowed:  entry.count <= maxRequests,
    remaining,
    resetAt:  entry.resetAt,
  };
}

// Clean up expired rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (entry.resetAt < now) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);
