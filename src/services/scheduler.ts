import type { ScheduledJob, Business, JobType } from '../types';
import { getDb } from '../db/client';
import { generateReport } from './report-generator';
import { sendReportEmail } from './email-service';

// ─── In-memory job registry ───────────────────────────────────────────────────

interface ActiveJob {
  id: string;
  name: string;
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
  lastRun?: Date;
}

const activeJobs = new Map<string, ActiveJob>();

// ─── Schedule parsing ─────────────────────────────────────────────────────────

function scheduleToMs(schedule: string): number {
  const map: Record<string, number> = {
    daily:   24 * 60 * 60 * 1000,
    weekly:   7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
    // cron-like shortcuts
    '@daily':   24 * 60 * 60 * 1000,
    '@weekly':   7 * 24 * 60 * 60 * 1000,
    '@monthly': 30 * 24 * 60 * 60 * 1000,
  };
  return map[schedule.toLowerCase()] || 30 * 24 * 60 * 60 * 1000;
}

function nextRunDate(schedule: string): Date {
  const ms = scheduleToMs(schedule);
  return new Date(Date.now() + ms);
}

// ─── Job handlers ─────────────────────────────────────────────────────────────

async function handleReportGeneration(job: ScheduledJob): Promise<void> {
  const db = getDb();

  // Get the business
  const [businessRow] = await db`SELECT * FROM businesses WHERE id = ${job.business_id}`;
  if (!businessRow) {
    throw new Error(`Business ${job.business_id} not found`);
  }
  const business = businessRow as Business;

  console.log(`[scheduler] Generating report for ${business.name}…`);
  const report = await generateReport(business);

  // Send email if subscription is active
  const [sub] = await db`
    SELECT * FROM subscriptions
    WHERE business_id = ${job.business_id} AND status = 'active'
    LIMIT 1
  `;
  if (sub) {
    await sendReportEmail(business, report);
    await db`UPDATE reports SET status = 'sent', sent_at = NOW() WHERE id = ${report.id}`;
    console.log(`[scheduler] Report sent to ${business.email}`);
  }
}

async function handleEmailSend(job: ScheduledJob): Promise<void> {
  console.log(`[scheduler] Email send job ${job.id} — no-op (handled by report generation)`);
}

async function handleDataRefresh(job: ScheduledJob): Promise<void> {
  console.log(`[scheduler] Data refresh job ${job.id} — refreshing API catalog cache…`);
  const { scanAllApis } = await import('./api-scanner');
  await scanAllApis(true);
}

const JOB_HANDLERS: Record<JobType, (job: ScheduledJob) => Promise<void>> = {
  report_generation: handleReportGeneration,
  email_send:        handleEmailSend,
  data_refresh:      handleDataRefresh,
};

// ─── Job execution ────────────────────────────────────────────────────────────

async function executeJob(jobId: string): Promise<void> {
  const db = getDb();

  // Mark as running
  const [jobRow] = await db`
    UPDATE scheduled_jobs
    SET status = 'running', last_run = NOW()
    WHERE id = ${jobId}
    RETURNING *
  `;
  if (!jobRow) return;

  const job = jobRow as ScheduledJob;
  const handler = JOB_HANDLERS[job.job_type];

  try {
    await handler(job);

    // Mark completed and schedule next run
    await db`
      UPDATE scheduled_jobs
      SET status = 'completed', next_run = ${nextRunDate(job.schedule).toISOString()}
      WHERE id = ${jobId}
    `;
    console.log(`[scheduler] Job ${jobId} (${job.job_type}) completed`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db`
      UPDATE scheduled_jobs
      SET status = 'failed', error_message = ${msg}, next_run = ${nextRunDate(job.schedule).toISOString()}
      WHERE id = ${jobId}
    `;
    console.error(`[scheduler] Job ${jobId} failed: ${msg}`);
  }
}

// ─── Scheduler lifecycle ──────────────────────────────────────────────────────

/**
 * Start the global scheduler — polls the DB every minute for due jobs.
 */
export function startScheduler(): void {
  console.log('[scheduler] Starting…');

  const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

  const timer = setInterval(async () => {
    try {
      await pollDueJobs();
    } catch (err) {
      console.error('[scheduler] Poll error:', err);
    }
  }, POLL_INTERVAL_MS);

  // Store the global poll timer
  activeJobs.set('__global_poll__', {
    id:         '__global_poll__',
    name:       'Global Job Poller',
    intervalMs: POLL_INTERVAL_MS,
    timer,
  });

  console.log('[scheduler] Started — polling every 60s');
}

async function pollDueJobs(): Promise<void> {
  const db = getDb();
  const dueJobs = await db`
    SELECT * FROM scheduled_jobs
    WHERE status IN ('pending', 'completed', 'failed')
      AND next_run <= NOW()
    ORDER BY next_run ASC
    LIMIT 10
  `;

  for (const job of dueJobs) {
    console.log(`[scheduler] Executing due job: ${job.id} (${job.job_type})`);
    // Fire and forget — errors are caught inside executeJob
    executeJob(job.id as string).catch(err =>
      console.error(`[scheduler] Unhandled error in job ${job.id}:`, err),
    );
  }
}

export function stopScheduler(): void {
  for (const [id, job] of activeJobs) {
    clearInterval(job.timer);
    activeJobs.delete(id);
  }
  console.log('[scheduler] Stopped.');
}

// ─── Job CRUD ─────────────────────────────────────────────────────────────────

export async function createJob(params: {
  business_id: string;
  job_type: JobType;
  schedule: string;
}): Promise<ScheduledJob> {
  const db = getDb();
  const [row] = await db`
    INSERT INTO scheduled_jobs (business_id, job_type, schedule, next_run)
    VALUES (
      ${params.business_id},
      ${params.job_type},
      ${params.schedule},
      ${nextRunDate(params.schedule).toISOString()}
    )
    RETURNING *
  `;
  return row as ScheduledJob;
}

export async function getJob(jobId: string): Promise<ScheduledJob | null> {
  const db = getDb();
  const [row] = await db`SELECT * FROM scheduled_jobs WHERE id = ${jobId}`;
  return (row as ScheduledJob) || null;
}

export async function listJobs(businessId?: string): Promise<ScheduledJob[]> {
  const db = getDb();
  const rows = businessId
    ? await db`SELECT * FROM scheduled_jobs WHERE business_id = ${businessId} ORDER BY created_at DESC`
    : await db`SELECT * FROM scheduled_jobs ORDER BY created_at DESC LIMIT 100`;
  return rows as ScheduledJob[];
}

export async function triggerJobManually(jobId: string): Promise<void> {
  const db = getDb();
  // Reset next_run to now so the poller picks it up immediately
  await db`UPDATE scheduled_jobs SET next_run = NOW(), status = 'pending' WHERE id = ${jobId}`;
  await executeJob(jobId);
}

export async function deleteJob(jobId: string): Promise<void> {
  const db = getDb();
  await db`DELETE FROM scheduled_jobs WHERE id = ${jobId}`;
}

/**
 * Bootstrap default jobs for a new business subscription.
 */
export async function bootstrapBusinessJobs(
  businessId: string,
  frequency: string,
): Promise<void> {
  await createJob({ business_id: businessId, job_type: 'report_generation', schedule: frequency });
  await createJob({ business_id: businessId, job_type: 'data_refresh',      schedule: 'weekly' });
  console.log(`[scheduler] Bootstrapped jobs for business ${businessId}`);
}
