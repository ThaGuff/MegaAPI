import { Hono } from 'hono';
import { getDb } from '../db/client';
import { generateReport, getReport, getBusinessReports } from '../services/report-generator';
import { sendReportEmail } from '../services/email-service';
import { createJob, getJob, listJobs, triggerJobManually, deleteJob } from '../services/scheduler';
import { handleError, NotFoundError, ValidationError } from '../middleware/error';
import { validateUuid, validateFrequency } from '../utils/validators';
import type { Business, Subscription, Report, ScheduledJob, ApiResponse } from '../types';

export const apiRouter = new Hono();

// ─── Businesses ───────────────────────────────────────────────────────────────

apiRouter.get('/businesses/:id', async (c) => {
  try {
    const id = validateUuid(c.req.param('id'), 'id');
    const db = getDb();
    const [row] = await db`SELECT * FROM businesses WHERE id = ${id}`;
    if (!row) throw new NotFoundError('Business');
    // Mask API key in response
    const business = { ...row as Business, api_key: '••••' + (row as Business).api_key.slice(-4) };
    return c.json<ApiResponse<Business>>({ success: true, data: business });
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.put('/businesses/:id', async (c) => {
  try {
    const id   = validateUuid(c.req.param('id'), 'id');
    const body = await c.req.json() as Partial<Business>;
    const db   = getDb();

    // Only allow updating safe fields
    const allowed = ['name', 'website', 'region', 'industry'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    const [row] = await db`
      UPDATE businesses
      SET ${db(updates)}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new NotFoundError('Business');
    return c.json<ApiResponse<Business>>({ success: true, data: row as Business });
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── Subscriptions ────────────────────────────────────────────────────────────

apiRouter.get('/subscriptions/:id', async (c) => {
  try {
    const id = validateUuid(c.req.param('id'), 'id');
    const db = getDb();
    const [row] = await db`SELECT * FROM subscriptions WHERE id = ${id}`;
    if (!row) throw new NotFoundError('Subscription');
    return c.json<ApiResponse<Subscription>>({ success: true, data: row as Subscription });
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.get('/subscriptions', async (c) => {
  try {
    const businessId = c.req.query('business_id');
    if (!businessId) throw new ValidationError('business_id query param is required');
    const db = getDb();
    const rows = await db`SELECT * FROM subscriptions WHERE business_id = ${businessId}`;
    return c.json<ApiResponse<Subscription[]>>({ success: true, data: rows as Subscription[] });
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.post('/subscriptions', async (c) => {
  try {
    const body = await c.req.json() as any;
    if (!body.business_id) throw new ValidationError('business_id is required');
    const businessId = validateUuid(body.business_id, 'business_id');
    const frequency  = validateFrequency(body.frequency);
    const plan       = body.plan || 'starter';

    const db = getDb();

    // Verify business exists
    const [biz] = await db`SELECT id FROM businesses WHERE id = ${businessId}`;
    if (!biz) throw new NotFoundError('Business');

    const [row] = await db`
      INSERT INTO subscriptions (business_id, plan, frequency)
      VALUES (${businessId}, ${plan}, ${frequency})
      RETURNING *
    `;
    return c.json<ApiResponse<Subscription>>({ success: true, data: row as Subscription }, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.put('/subscriptions/:id', async (c) => {
  try {
    const id   = validateUuid(c.req.param('id'), 'id');
    const body = await c.req.json() as any;
    const db   = getDb();

    const updates: Record<string, unknown> = {};
    if (body.status)    updates.status    = body.status;
    if (body.frequency) updates.frequency = validateFrequency(body.frequency);
    if (body.plan)      updates.plan      = body.plan;

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No valid fields to update');
    }

    const [row] = await db`
      UPDATE subscriptions
      SET ${db(updates)}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new NotFoundError('Subscription');
    return c.json<ApiResponse<Subscription>>({ success: true, data: row as Subscription });
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── Reports ──────────────────────────────────────────────────────────────────

apiRouter.get('/reports/:id', async (c) => {
  try {
    const id     = validateUuid(c.req.param('id'), 'id');
    const report = await getReport(id);
    if (!report) throw new NotFoundError('Report');
    return c.json<ApiResponse<Report>>({ success: true, data: report });
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.get('/reports', async (c) => {
  try {
    const businessId = c.req.query('business_id');
    if (!businessId) throw new ValidationError('business_id query param is required');
    const reports = await getBusinessReports(businessId);
    return c.json<ApiResponse<Report[]>>({ success: true, data: reports });
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.post('/reports/generate', async (c) => {
  try {
    const body = await c.req.json() as any;
    if (!body.business_id) throw new ValidationError('business_id is required');

    const db = getDb();
    const [businessRow] = await db`SELECT * FROM businesses WHERE id = ${body.business_id}`;
    if (!businessRow) throw new NotFoundError('Business');

    const business = businessRow as Business;
    const report   = await generateReport(business, body.title);

    if (body.send_email) {
      sendReportEmail(business, report).catch(err =>
        console.error('[api] Report email failed:', err),
      );
    }

    return c.json<ApiResponse<Report>>({ success: true, data: report }, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── Scheduled jobs ───────────────────────────────────────────────────────────

apiRouter.get('/scheduled-jobs/:id', async (c) => {
  try {
    const id  = validateUuid(c.req.param('id'), 'id');
    const job = await getJob(id);
    if (!job) throw new NotFoundError('Scheduled job');
    return c.json<ApiResponse<ScheduledJob>>({ success: true, data: job });
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.get('/scheduled-jobs', async (c) => {
  try {
    const businessId = c.req.query('business_id');
    const jobs = await listJobs(businessId);
    return c.json<ApiResponse<ScheduledJob[]>>({ success: true, data: jobs });
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.post('/scheduled-jobs', async (c) => {
  try {
    const body = await c.req.json() as any;
    if (!body.business_id) throw new ValidationError('business_id is required');
    if (!body.job_type)    throw new ValidationError('job_type is required');
    if (!body.schedule)    throw new ValidationError('schedule is required');

    const job = await createJob({
      business_id: validateUuid(body.business_id, 'business_id'),
      job_type:    body.job_type,
      schedule:    body.schedule,
    });
    return c.json<ApiResponse<ScheduledJob>>({ success: true, data: job }, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

apiRouter.delete('/scheduled-jobs/:id', async (c) => {
  try {
    const id = validateUuid(c.req.param('id'), 'id');
    await deleteJob(id);
    return c.json<ApiResponse>({ success: true, message: 'Job deleted' });
  } catch (err) {
    return handleError(c, err);
  }
});
