import type { EmailPayload, Business, Report } from '../types';

// ─── Email provider abstraction ───────────────────────────────────────────────

interface SendResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

// ─── Resend provider ──────────────────────────────────────────────────────────

async function sendViaResend(payload: EmailPayload): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const fromAddress = process.env.EMAIL_FROM || 'reports@yourdomain.com';

  const body: Record<string, unknown> = {
    from: fromAddress,
    to:   [payload.to],
    subject: payload.subject,
    html: payload.html,
  };
  if (payload.text) body.text = payload.text;
  if (payload.attachments?.length) {
    body.attachments = payload.attachments.map(a => ({
      filename:    a.filename,
      content:     a.content,
      content_type: a.content_type,
    }));
  }

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await res.json() as any;
  if (!res.ok) {
    return { success: false, error: json.message || `HTTP ${res.status}` };
  }
  return { success: true, message_id: json.id };
}

// ─── SMTP provider (nodemailer-style via fetch to a relay) ────────────────────

async function sendViaSmtp(payload: EmailPayload): Promise<SendResult> {
  // Fallback: log to console in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('[email] SMTP send (dev mode — not actually sent):');
    console.log(`  To:      ${payload.to}`);
    console.log(`  Subject: ${payload.subject}`);
    return { success: true, message_id: `dev-${Date.now()}` };
  }
  return { success: false, error: 'SMTP not configured for production' };
}

// ─── Retry logic ──────────────────────────────────────────────────────────────

async function sendWithRetry(
  payload: EmailPayload,
  maxRetries = 3,
): Promise<SendResult> {
  let lastError = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const provider = process.env.RESEND_API_KEY ? sendViaResend : sendViaSmtp;
      const result = await provider(payload);
      if (result.success) return result;
      lastError = result.error || 'Unknown error';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < maxRetries) {
      const delay = attempt * 1000; // 1s, 2s, 3s
      console.warn(`[email] Attempt ${attempt} failed, retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.error(`[email] All ${maxRetries} attempts failed: ${lastError}`);
  return { success: false, error: lastError };
}

// ─── Email templates ──────────────────────────────────────────────────────────

export function buildWelcomeEmail(business: Business): EmailPayload {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 40px 32px; color: #fff; }
  .header h1 { font-size: 24px; margin: 0 0 8px; }
  .header p { margin: 0; opacity: .85; }
  .body { padding: 32px; }
  .body h2 { font-size: 18px; color: #1e293b; margin: 0 0 16px; }
  .body p { color: #475569; line-height: 1.6; margin: 0 0 16px; }
  .api-key { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; font-family: monospace; font-size: 14px; color: #1e293b; word-break: break-all; }
  .btn { display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; margin-top: 16px; }
  .footer { padding: 24px 32px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 12px; }
</style></head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Revenue Intelligence Suite</h1>
      <p>Your business intelligence platform is ready.</p>
    </div>
    <div class="body">
      <h2>Hi ${escHtml(business.name)},</h2>
      <p>Your account has been created successfully. You now have access to 10,000+ APIs across 18 categories, all mapped to real business outcomes.</p>
      <p><strong>Your API Key:</strong></p>
      <div class="api-key">${escHtml(business.api_key)}</div>
      <p style="margin-top:16px">Keep this key secure — it authenticates all API requests.</p>
      <p><strong>Your plan:</strong> ${escHtml(business.plan.charAt(0).toUpperCase() + business.plan.slice(1))}</p>
      <a href="${process.env.APP_URL || 'http://localhost:3000'}/dashboard" class="btn">Open Dashboard →</a>
    </div>
    <div class="footer">
      Revenue Intelligence Suite · Unsubscribe · Privacy Policy
    </div>
  </div>
</body>
</html>`;

  return {
    to:      business.email,
    subject: `Welcome to Revenue Intelligence Suite, ${business.name}!`,
    html,
    text:    `Welcome ${business.name}! Your API key: ${business.api_key}. Visit ${process.env.APP_URL || 'http://localhost:3000'}/dashboard`,
  };
}

export function buildReportEmail(business: Business, report: Report): EmailPayload {
  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  const kpis = (report.data as any)?.kpis || {};
  const period = (report.data as any)?.meta?.period || 'This Month';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 40px 32px; color: #fff; }
  .header h1 { font-size: 22px; margin: 0 0 8px; }
  .header p { margin: 0; opacity: .85; }
  .body { padding: 32px; }
  .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 24px 0; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; text-align: center; }
  .kpi .value { font-size: 22px; font-weight: 700; color: #6366f1; }
  .kpi .label { font-size: 11px; color: #64748b; margin-top: 4px; }
  .btn { display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; }
  .footer { padding: 24px 32px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 12px; }
</style></head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escHtml(report.title)}</h1>
      <p>${escHtml(business.name)} · ${escHtml(period)}</p>
    </div>
    <div class="body">
      <p>Your monthly revenue intelligence report is ready. Here's your executive summary:</p>
      <div class="kpis">
        <div class="kpi"><div class="value">${kpis.total_opportunities || 0}</div><div class="label">Opportunities</div></div>
        <div class="kpi"><div class="value">${fmtCurrency(kpis.estimated_pipeline || 0)}</div><div class="label">Est. Pipeline</div></div>
        <div class="kpi"><div class="value">${fmtCurrency(kpis.potential_savings || 0)}</div><div class="label">Potential Savings</div></div>
        <div class="kpi"><div class="value">${kpis.avg_opportunity_score || 0}</div><div class="label">Avg Score</div></div>
      </div>
      <p>View the full interactive report in your dashboard:</p>
      <a href="${process.env.APP_URL || 'http://localhost:3000'}/dashboard/reports/${report.id}" class="btn">View Full Report →</a>
    </div>
    <div class="footer">
      Revenue Intelligence Suite · You're receiving this because you subscribed to ${escHtml(business.plan)} plan reports.
    </div>
  </div>
</body>
</html>`;

  return {
    to:      business.email,
    subject: `Your ${period} Revenue Intelligence Report is ready`,
    html,
    text:    `Your report is ready. View it at: ${process.env.APP_URL || 'http://localhost:3000'}/dashboard/reports/${report.id}`,
  };
}

export function buildAlertEmail(
  business: Business,
  alertType: string,
  message: string,
): EmailPayload {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; }
  .header { background: #ef4444; padding: 24px 32px; color: #fff; }
  .header h1 { font-size: 18px; margin: 0; }
  .body { padding: 32px; color: #475569; line-height: 1.6; }
  .footer { padding: 16px 32px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 12px; }
</style></head>
<body>
  <div class="container">
    <div class="header"><h1>⚠️ Alert: ${escHtml(alertType)}</h1></div>
    <div class="body">
      <p>Hi ${escHtml(business.name)},</p>
      <p>${escHtml(message)}</p>
      <p><a href="${process.env.APP_URL || 'http://localhost:3000'}/dashboard">View Dashboard →</a></p>
    </div>
    <div class="footer">Revenue Intelligence Suite</div>
  </div>
</body>
</html>`;

  return {
    to:      business.email,
    subject: `Alert: ${alertType} — ${business.name}`,
    html,
    text:    `Alert: ${alertType}\n\n${message}`,
  };
}

function escHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Public send functions ────────────────────────────────────────────────────

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  return sendWithRetry(payload);
}

export async function sendWelcomeEmail(business: Business): Promise<SendResult> {
  const payload = buildWelcomeEmail(business);
  return sendWithRetry(payload);
}

export async function sendReportEmail(business: Business, report: Report): Promise<SendResult> {
  const payload = buildReportEmail(business, report);
  return sendWithRetry(payload);
}

export async function sendTestEmail(to: string): Promise<SendResult> {
  return sendWithRetry({
    to,
    subject: 'Revenue Intelligence Suite — Test Email',
    html: `<h1>Test email</h1><p>If you received this, email delivery is working correctly.</p><p>Sent at: ${new Date().toISOString()}</p>`,
    text: `Test email sent at ${new Date().toISOString()}`,
  });
}
