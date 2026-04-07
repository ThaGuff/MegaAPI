import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { runMigrations, closeDb, checkDbConnection } from './db/client';
import { landingRouter } from './routes/landing';
import { dashboardRouter } from './routes/dashboard';
import { apiRouter } from './routes/api';
import { adminRouter } from './routes/admin';
import { errorHandler } from './middleware/error';
import { requestLogger } from './middleware/logging';
import { requireAdmin } from './middleware/auth';
import { startScheduler, stopScheduler } from './services/scheduler';

// ─── App setup ────────────────────────────────────────────────────────────────

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use('*', cors({
  origin:      process.env.CORS_ORIGIN || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Admin-Secret'],
  exposeHeaders: ['X-Request-Id'],
  maxAge:      86400,
}));

app.use('*', secureHeaders());
app.use('*', requestLogger());
app.use('*', errorHandler());

// ─── Routes ───────────────────────────────────────────────────────────────────

// Landing / public pages
app.route('/', landingRouter);

// Dashboard (interactive UI + JSON API)
app.route('/dashboard', dashboardRouter);

// REST API
app.route('/api', apiRouter);

// Admin (protected by X-Admin-Secret header)
app.use('/admin/*', async (c, next) => {
  // Allow GET /admin/health without auth
  if (c.req.method === 'GET' && c.req.path === '/admin/health') return next();
  // Allow GET /admin/ (dashboard) without auth in dev
  if (process.env.NODE_ENV !== 'production' && c.req.method === 'GET') return next();
  return requireAdmin()(c, next);
});
app.route('/admin', adminRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.notFound((c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/html')) {
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>404 — Not Found</title>
<style>body{font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center}.code{font-size:80px;font-weight:800;color:#6366f1}.msg{color:#94a3b8;margin:8px 0 24px}a{color:#6366f1}</style>
</head>
<body><div class="box"><div class="code">404</div><div class="msg">Page not found</div><a href="/">← Back to home</a></div></body>
</html>`, 404);
  }
  return c.json({ success: false, error: 'Not found' }, 404);
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  const port = parseInt(process.env.PORT || '3000', 10);

  console.log('');
  console.log('  ⚡ Revenue Intelligence Suite');
  console.log('  ─────────────────────────────');

  // Run DB migrations
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations();
    } catch (err) {
      console.error('[startup] Database migration failed:', err);
      console.warn('[startup] Continuing without database — some features will be unavailable');
    }
  } else {
    console.warn('[startup] DATABASE_URL not set — database features disabled');
  }

  // Start scheduler
  if (process.env.DATABASE_URL && process.env.ENABLE_SCHEDULER !== 'false') {
    try {
      startScheduler();
    } catch (err) {
      console.warn('[startup] Scheduler failed to start:', err);
    }
  }

  // Start HTTP server
  const server = Bun.serve({
    port,
    fetch: app.fetch,
  });

  console.log(`  🌐 Server:     http://localhost:${port}`);
  console.log(`  📊 Dashboard:  http://localhost:${port}/dashboard`);
  console.log(`  🔧 Admin:      http://localhost:${port}/admin`);
  console.log(`  ❤️  Health:     http://localhost:${port}/admin/health`);
  console.log(`  📖 API:        http://localhost:${port}/api`);
  console.log('');

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(`\n[shutdown] Received ${signal}, shutting down gracefully…`);
    stopScheduler();
    await closeDb();
    server.stop();
    console.log('[shutdown] Done.');
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch(err => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});

export default app;
