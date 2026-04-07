import type {
  Business,
  Report,
  ReportData,
  ReportMeta,
  ReportKpis,
  Opportunity,
  RevenueLever,
} from '../types';
import { recommendSolutions } from './business-solver';
import { getDb } from '../db/client';

// ─── Report generation ────────────────────────────────────────────────────────

export async function generateReport(
  business: Business,
  title?: string,
): Promise<Report> {
  const db = getDb();

  // Create a pending report record
  const [reportRow] = await db`
    INSERT INTO reports (business_id, title, status)
    VALUES (${business.id}, ${title || 'Revenue Intelligence Report'}, 'generating')
    RETURNING *
  `;
  const reportId = reportRow.id as string;

  try {
    // Generate report data
    const data = await buildReportData(business);
    const html = renderReportHtml(data, business);

    // Update report with generated data
    const [updated] = await db`
      UPDATE reports
      SET data = ${db.json(data)}, html_content = ${html}, status = 'ready', generated_at = NOW()
      WHERE id = ${reportId}
      RETURNING *
    `;

    return updated as Report;
  } catch (err) {
    await db`UPDATE reports SET status = 'failed' WHERE id = ${reportId}`;
    throw err;
  }
}

async function buildReportData(business: Business): Promise<ReportData> {
  // Get recommended solutions
  const solutions = await recommendSolutions({
    industry: business.industry,
    goals: ['revenue growth', 'lead generation', 'competitor monitoring'],
    limit: 15,
  });

  // Build opportunities from solutions
  const opportunities: Opportunity[] = solutions.slice(0, 10).map((s, i) => ({
    id: i + 1,
    title: s.use_case,
    detail: s.api.description.slice(0, 200),
    source: s.api.data_sources[0] || s.api.category,
    lever: s.api.revenue_levers[0] as RevenueLever,
    impact: s.impact_estimate,
    savings: s.savings_estimate,
    score: s.score,
    priority: s.api.impact_level,
    eta_days: Math.floor(Math.random() * 14) + 1,
    owner: ownerByLever(s.api.revenue_levers[0] as RevenueLever),
    status: 'New',
  }));

  // KPIs
  const totalImpact = opportunities.reduce((sum, o) => sum + o.impact, 0);
  const totalSavings = opportunities.reduce((sum, o) => sum + o.savings, 0);
  const avgScore = opportunities.length
    ? Math.round(opportunities.reduce((sum, o) => sum + o.score, 0) / opportunities.length)
    : 0;

  const leverCounts: Record<string, number> = {};
  for (const o of opportunities) {
    leverCounts[o.lever] = (leverCounts[o.lever] || 0) + 1;
  }
  const topLever = Object.entries(leverCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Revenue Growth';

  const kpis: ReportKpis = {
    total_opportunities: opportunities.length,
    estimated_pipeline: totalImpact,
    potential_savings: totalSavings,
    avg_opportunity_score: avgScore,
    top_lever: topLever,
  };

  const meta: ReportMeta = {
    title: 'Revenue Intelligence Report',
    business_name: business.name,
    industry: business.industry,
    generated_at: new Date().toISOString(),
    period: getPeriodLabel(),
  };

  const recommendations = generateRecommendations(opportunities, business.industry);

  return {
    meta,
    opportunities,
    leads: [],
    pricing: [],
    reviews: [],
    seo: [],
    creative: [],
    recommendations,
    kpis,
  };
}

function ownerByLever(lever: RevenueLever): string {
  const map: Record<RevenueLever, string> = {
    'Revenue Growth':     'Sales',
    'Cost Savings':       'Ops',
    'Revenue Protection': 'Marketing',
  };
  return map[lever] || 'Team';
}

function getPeriodLabel(): string {
  const now = new Date();
  return `${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()}`;
}

function generateRecommendations(opportunities: Opportunity[], industry: string): string[] {
  const recs: string[] = [];
  const highPriority = opportunities.filter(o => o.priority === 'High');
  const growthOpps = opportunities.filter(o => o.lever === 'Revenue Growth');
  const savingsOpps = opportunities.filter(o => o.lever === 'Cost Savings');

  if (highPriority.length > 0) {
    recs.push(`Prioritise the ${highPriority.length} high-impact opportunities identified — these represent the fastest path to measurable ROI.`);
  }
  if (growthOpps.length > 0) {
    recs.push(`Focus on ${growthOpps[0].title} as your primary revenue growth lever this month.`);
  }
  if (savingsOpps.length > 0) {
    recs.push(`Implement ${savingsOpps[0].title} to reduce operational waste and improve margins.`);
  }
  recs.push(`Schedule a weekly data refresh to keep intelligence current and actionable.`);
  recs.push(`Set up automated alerts for competitor pricing and review changes to protect revenue.`);
  recs.push(`Build a 90-day implementation roadmap starting with the top 3 scored opportunities.`);

  return recs;
}

// ─── HTML report renderer ─────────────────────────────────────────────────────

export function renderReportHtml(data: ReportData, business: Business): string {
  const { meta, opportunities, kpis, recommendations } = data;
  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  const oppRows = opportunities
    .map(
      o => `
      <tr>
        <td>${escHtml(o.title)}</td>
        <td><span class="badge badge-${o.lever.toLowerCase().replace(/ /g, '-')}">${escHtml(o.lever)}</span></td>
        <td>${escHtml(o.source)}</td>
        <td>${o.impact > 0 ? fmtCurrency(o.impact) : '—'}</td>
        <td>${o.savings > 0 ? fmtCurrency(o.savings) : '—'}</td>
        <td><span class="score">${o.score}</span></td>
        <td><span class="priority priority-${o.priority.toLowerCase()}">${o.priority}</span></td>
      </tr>`,
    )
    .join('');

  const recItems = recommendations.map(r => `<li>${escHtml(r)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(meta.title)} — ${escHtml(meta.business_name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
    .report { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; }
    .brand { font-size: 22px; font-weight: 700; color: #6366f1; }
    .meta { text-align: right; color: #64748b; font-size: 13px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    h2 { font-size: 18px; font-weight: 600; margin: 32px 0 16px; color: #1e293b; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin: 24px 0; }
    .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; text-align: center; }
    .kpi .value { font-size: 28px; font-weight: 700; color: #6366f1; }
    .kpi .label { font-size: 12px; color: #64748b; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    th { background: #f1f5f9; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
    td { padding: 12px 16px; border-top: 1px solid #f1f5f9; font-size: 14px; }
    tr:hover td { background: #f8fafc; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
    .badge-revenue-growth { background: #dcfce7; color: #166534; }
    .badge-cost-savings { background: #dbeafe; color: #1e40af; }
    .badge-revenue-protection { background: #fef3c7; color: #92400e; }
    .score { display: inline-block; background: #6366f1; color: #fff; border-radius: 9999px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
    .priority { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
    .priority-high { background: #fee2e2; color: #991b1b; }
    .priority-medium { background: #fef3c7; color: #92400e; }
    .priority-low { background: #f1f5f9; color: #475569; }
    .recommendations { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
    .recommendations ol { padding-left: 20px; }
    .recommendations li { margin-bottom: 12px; font-size: 14px; line-height: 1.6; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px; }
    @media print { body { background: #fff; } .report { padding: 20px; } }
  </style>
</head>
<body>
  <div class="report">
    <div class="header">
      <div>
        <div class="brand">Revenue Intelligence Suite</div>
        <h1>${escHtml(meta.title)}</h1>
        <div style="color:#64748b;margin-top:4px">${escHtml(meta.business_name)} · ${escHtml(meta.industry)}</div>
      </div>
      <div class="meta">
        <div>Period: ${escHtml(meta.period)}</div>
        <div>Generated: ${new Date(meta.generated_at).toLocaleDateString()}</div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="value">${kpis.total_opportunities}</div><div class="label">Opportunities</div></div>
      <div class="kpi"><div class="value">${fmtCurrency(kpis.estimated_pipeline)}</div><div class="label">Est. Pipeline</div></div>
      <div class="kpi"><div class="value">${fmtCurrency(kpis.potential_savings)}</div><div class="label">Potential Savings</div></div>
      <div class="kpi"><div class="value">${kpis.avg_opportunity_score}</div><div class="label">Avg Score</div></div>
      <div class="kpi"><div class="value">${escHtml(kpis.top_lever.split(' ')[0])}</div><div class="label">Top Lever</div></div>
    </div>

    <h2>Top Opportunities</h2>
    <table>
      <thead>
        <tr>
          <th>Opportunity</th>
          <th>Lever</th>
          <th>Source</th>
          <th>Impact</th>
          <th>Savings</th>
          <th>Score</th>
          <th>Priority</th>
        </tr>
      </thead>
      <tbody>${oppRows}</tbody>
    </table>

    <h2>Recommendations</h2>
    <div class="recommendations">
      <ol>${recItems}</ol>
    </div>

    <div class="footer">
      Confidential — prepared by Revenue Intelligence Suite · ${new Date().getFullYear()}
    </div>
  </div>
</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Report retrieval ─────────────────────────────────────────────────────────

export async function getReport(reportId: string): Promise<Report | null> {
  const db = getDb();
  const [row] = await db`SELECT * FROM reports WHERE id = ${reportId}`;
  return (row as Report) || null;
}

export async function getBusinessReports(businessId: string): Promise<Report[]> {
  const db = getDb();
  const rows = await db`
    SELECT id, business_id, title, generated_at, sent_at, status, created_at
    FROM reports
    WHERE business_id = ${businessId}
    ORDER BY generated_at DESC
    LIMIT 50
  `;
  return rows as Report[];
}

export async function markReportSent(reportId: string): Promise<void> {
  const db = getDb();
  await db`UPDATE reports SET status = 'sent', sent_at = NOW() WHERE id = ${reportId}`;
}
