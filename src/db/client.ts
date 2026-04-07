import postgres from 'postgres';
import { ALL_MIGRATIONS } from './schema';

// ─── Connection singleton ─────────────────────────────────────────────────────

let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
  if (_sql) return _sql;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  _sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    onnotice: () => {}, // suppress NOTICE messages
  });

  return _sql;
}

// Convenience alias
export const sql = new Proxy({} as ReturnType<typeof postgres>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
  apply(_target, _thisArg, args) {
    return (getDb() as any)(...args);
  },
});

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkDbConnection(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const db = getDb();
    await db`SELECT 1 AS ping`;
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Migration runner ─────────────────────────────────────────────────────────

export async function runMigrations(): Promise<void> {
  const db = getDb();
  console.log('[db] Running migrations…');
  for (const migration of ALL_MIGRATIONS) {
    try {
      await db.unsafe(migration);
    } catch (err) {
      // Ignore "already exists" errors from CREATE IF NOT EXISTS
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) {
        console.error('[db] Migration error:', msg);
        throw err;
      }
    }
  }
  console.log('[db] Migrations complete.');
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
    console.log('[db] Connection pool closed.');
  }
}
