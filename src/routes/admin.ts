import { Hono } from 'hono';
import { checkDbConnection } from '../db/client';
import { getCatalogStats, scanAllApis, seedApiCatalog } from '../services/api-scanner';
import { sendTestEmail } from '../services/email-service';
import { listJobs, triggerJobManually } from '../services/scheduler';
import { getRecentLogs, getMetrics } from '../middleware/logging';
import { handleError, ValidationError } from '../middleware/error';
import type { ApiResponse } from '../types';

export const adminRouter = new Hono();

// ─── Health check ─────────────────────────────────────────────────────────────

adminRouter.get('/health', async (c) => {
  const db = await checkDbConnection();
  const catalog = await getCatalogStats().catch(() => ({ total: 0, by_category: {}, by_impact: {} }));
  const metrics = getMetrics();

  const status = db.ok ? 'healthy' : 'degraded';

  return c.json({
    status,
    timestamp: new Date().toISOString(),
    version:   process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: {
        ok:         db.ok,
        latency_ms: db.latency_ms,
        error:      db.error,
      },
      api_catalog: {
        total_apis:   catalog.total,
        by_impact:    catalog.by_impact,
      },
    },
    performance: {
      uptime_seconds:   metrics.uptime_seconds,
      requests_total:   metrics.requests_total,
      avg_duration_ms:  metrics.avg_duration_ms,
      p95_duration_ms:  metrics.p95_duration_ms,
    },
  }, db.ok ? 200 : 503);
});

// ─── Debug info ───────────────────────────────────────────────────────────────

adminRouter.get('/debug', async (c) => {
  const isDev = process.env.NODE_ENV !== 'production';

  return c.json({
    success: true,
    data: {
      node_env:    process.env.NODE_ENV,
      bun_version: process.versions?.bun,
      memory:      process.memoryUsage(),
      env_vars: isDev ? {
        DATABASE_URL:   process.env.DATABASE_URL ? '✓ set' : '✗ missing',
        RESEND_API_KEY: process.env.RESEND_API_KEY ? '✓ set' : '✗ missing',
        JWT_SECRET:     process.env.JWT_SECRET ? '✓ set' : '✗ missing (using default)',
        ADMIN_SECRET:   process.env.ADMIN_SECRET ? '✓ set' : '✗ missing',
        APP_URL:        process.env.APP_URL || 'http://localhost:3000',
        EMAIL_FROM:     process.env.EMAIL_FROM || 'not set',
      } : 'hidden in production',
    },
  });
});

// ─── Logs ─────────────────────────────────────────────────────────────────────

adminRouter.get('/logs', (c) => {
  const limit = Math.min(500, parseInt(c.req.query('limit') || '100', 10));
  const logs  = getRecentLogs(limit);
  return c.json({ success: true, data: logs, total: logs.length });
});

// ─── Metrics ──────────────────────────────────────────────────────────────────

adminRouter.get('/metrics', (c) => {
  return c.json({ success: true, data: getMetrics() });
});

// ─── Email test ───────────────────────────────────────────────────────────────

adminRouter.post('/test-email', async (c) => {
  try {
    const body = await c.req.json() as any;
    if (!body.to) throw new ValidationError('to email address is required');

    const result = await sendTestEmail(body.to);
    return c.json<ApiResponse>({
      success: result.success,
      message: result.success ? `Test email sent to ${body.to}` : result.error,
    });
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── Scheduled jobs ───────────────────────────────────────────────────────────

adminRouter.get('/jobs', async (c) => {
  try {
    const jobs = await listJobs();
    return c.json({ success: true, data: jobs, total: jobs.length });
  } catch (err) {
    return handleError(c, err);
  }
});

adminRouter.post('/jobs/:id/run', async (c) => {
  try {
    const id = c.req.param('id');
    await triggerJobManually(id);
    return c.json<ApiResponse>({ success: true, message: `Job ${id} triggered` });
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── API catalog management ───────────────────────────────────────────────────

adminRouter.get('/catalog/stats', async (c) => {
  try {
    const stats = await getCatalogStats();
    return c.json({ success: true, data: stats });
  } catch (err) {
    return handleError(c, err);
  }
});

adminRouter.post('/catalog/refresh', async (c) => {
  try {
    const apis = await scanAllApis(true);
    return c.json<ApiResponse>({
      success: true,
      message: `Catalog refreshed: ${apis.length} APIs loaded`,
    });
  } catch (err) {
    return handleError(c, err);
  }
});

adminRouter.post('/catalog/seed', async (c) => {
  try {
    const inserted = await seedApiCatalog();
    return c.json<ApiResponse>({
      success: true,
      message: `Seeded ${inserted} APIs into database`,
    });
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── Admin dashboard HTML ─────────────────────────────────────────────────────

adminRouter.get('/', async (c) => {
  const db      = await checkDbConnection();
  const metrics = getMetrics();
  const logs    = getRecentLogs(20);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin — Revenue Intelligence Suite</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f1f5f9; padding: 32px; }
    h1 { font-size: 24px; font-weight: 700; color: #6366f1; margin-bottom: 24px; }
    h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; }
    .card .value { font-size: 28px; font-weight: 700; color: #6366f1; }
    .card .label { font-size: 12px; color: #64748b; margin-top: 4px; }
    .status-ok   { color: #22c55e; }
    .status-fail { color: #ef4444; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
    th { background: #334155; padding: 10px 16px; text-align: left; font-size: 11px; color: #64748b; text-transform: uppercase; }
    td { padding: 10px 16px; border-top: 1px solid #334155; font-size: 13px; font-family: monospace; }
    .section { margin-bottom: 40px; }
    .btn { display: inline-block; background: #6366f1; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; margin-right: 8px; }
    .btn:hover { background: #4f46e5; }
    .btn-danger { background: #ef4444; }
    .btn-danger:hover { background: #dc2626; }
    a { color: #6366f1; }
  </style>
</head>
<body>
  <h1>⚡ Admin Dashboard</h1>

  <div class="section">
    <h2>System Status</h2>
    <div class="grid">
      <div class="card">
        <div class="value ${db.ok ? 'status-ok' : 'status-fail'}">${db.ok ? '✓ Online' : '✗ Offline'}</div>
        <div class="label">Database (${db.latency_ms}ms)</div>
      </div>
      <div class="card">
        <div class="value">${metrics.uptime_seconds.toLocaleString()}s</div>
        <div class="label">Uptime</div>
      </div>
      <div class="card">
        <div class="value">${metrics.requests_total.toLocaleString()}</div>
        <div class="label">Total Requests</div>
      </div>
      <div class="card">
        <div class="value">${metrics.avg_duration_ms}ms</div>
        <div class="label">Avg Response Time</div>
      </div>
      <div class="card">
        <div class="value">${metrics.p95_duration_ms}ms</div>
        <div class="label">P95 Response Time</div>
      </div>
      <div class="card">
        <div class="value">${metrics.requests_error.toLocaleString()}</div>
        <div class="label">Error Requests</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Quick Actions</h2>
    <button class="btn" onclick="refreshCatalog()">🔄 Refresh API Catalog</button>
    <button class="btn" onclick="seedCatalog()">🌱 Seed Database</button>
    <button class="btn" onclick="testEmail()">📧 Test Email</button>
    <a href="/admin/health" class="btn" style="text-decoration:none">❤️ Health Check</a>
    <a href="/admin/logs" class="btn" style="text-decoration:none">📋 View Logs</a>
    <a href="/dashboard" class="btn" style="text-decoration:none">📊 Dashboard</a>
  </div>

  <div class="section">
    <h2>Recent Requests</h2>
    <table>
      <thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th></tr></thead>
      <tbody>
        ${logs.map(l => `
          <tr>
            <td>${new Date(l.timestamp).toLocaleTimeString()}</td>
            <td>${l.method}</td>
            <td>${l.path}</td>
            <td style="color:${l.status < 400 ? '#22c55e' : '#ef4444'}">${l.status}</td>
            <td>${l.duration}ms</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <script>
    async function refreshCatalog() {
      const r = await fetch('/admin/catalog/refresh', { method: 'POST', headers: { 'X-Admin-Secret': prompt('Admin secret:') || '' } });
      const j = await r.json();
      alert(j.message || j.error);
    }
    async function seedCatalog() {
      const r = await fetch('/admin/catalog/seed', { method: 'POST', headers: { 'X-Admin-Secret': prompt('Admin secret:') || '' } });
      const j = await r.json();
      alert(j.message || j.error);
    }
    async function testEmail() {
      const to = prompt('Send test email to:');
      if (!to) return;
      const r = await fetch('/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': prompt('Admin secret:') || '' },
        body: JSON.stringify({ to }),
      });
      const j = await r.json();
      alert(j.message || j.error);
    }
    // Auto-refresh every 30s
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;

  return c.html(html);
});
