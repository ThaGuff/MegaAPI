import { Hono } from 'hono';
import { getFilteredApis, getCatalogStats } from '../services/api-scanner';
import { recommendSolutions, saveSolution, getBusinessSolutions, updateSolutionStatus } from '../services/business-solver';
import { generateReport, getBusinessReports, getReport } from '../services/report-generator';
import { sendReportEmail } from '../services/email-service';
import { handleError, NotFoundError, ValidationError } from '../middleware/error';
import { validatePaginationParams } from '../utils/validators';
import { getDb } from '../db/client';
import type { Business, ApiCategory, Industry, RevenueLever, ImpactLevel } from '../types';

export const dashboardRouter = new Hono();

// ─── Main dashboard page ──────────────────────────────────────────────────────

dashboardRouter.get('/', async (c) => {
  try {
    const stats = await getCatalogStats();
    return c.html(renderDashboardPage(stats));
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── API catalog browser ──────────────────────────────────────────────────────

dashboardRouter.get('/apis', async (c) => {
  try {
    const query = c.req.query();
    const { page, limit } = validatePaginationParams(query);

    const { data, total } = await getFilteredApis({
      category: query.category as ApiCategory,
      industry: query.industry as Industry,
      lever:    query.lever    as RevenueLever,
      impact:   query.impact   as ImpactLevel,
      search:   query.search,
      page,
      limit,
    });

    return c.json({
      success: true,
      data,
      total,
      page,
      limit,
      has_more: page * limit < total,
    });
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── Solutions ────────────────────────────────────────────────────────────────

dashboardRouter.get('/solutions', async (c) => {
  try {
    const query = c.req.query();
    const industry = (query.industry || 'SaaS') as Industry;
    const goals    = query.goals ? query.goals.split(',') : ['revenue growth', 'lead generation'];
    const limit    = Math.min(50, parseInt(query.limit || '20', 10));

    const solutions = await recommendSolutions({ industry, goals, limit });
    return c.json({ success: true, data: solutions, total: solutions.length });
  } catch (err) {
    return handleError(c, err);
  }
});

dashboardRouter.post('/solutions', async (c) => {
  try {
    const body = await c.req.json() as any;
    if (!body.business_id || !body.api_id || !body.use_case) {
      throw new ValidationError('business_id, api_id, and use_case are required');
    }

    const solution = await saveSolution({
      business_id:      body.business_id,
      api_id:           body.api_id,
      use_case:         body.use_case,
      impact_estimate:  Number(body.impact_estimate)  || 0,
      savings_estimate: Number(body.savings_estimate) || 0,
      score:            Number(body.score)            || 50,
    });

    return c.json({ success: true, data: solution }, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

dashboardRouter.get('/solutions/:businessId', async (c) => {
  try {
    const solutions = await getBusinessSolutions(c.req.param('businessId'));
    return c.json({ success: true, data: solutions });
  } catch (err) {
    return handleError(c, err);
  }
});

dashboardRouter.patch('/solutions/:id/status', async (c) => {
  try {
    const body = await c.req.json() as any;
    if (!body.status) throw new ValidationError('status is required');
    const solution = await updateSolutionStatus(c.req.param('id'), body.status, body.notes);
    return c.json({ success: true, data: solution });
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── Reports ──────────────────────────────────────────────────────────────────

dashboardRouter.get('/reports', async (c) => {
  try {
    const businessId = c.req.query('business_id');
    if (!businessId) throw new ValidationError('business_id query param is required');
    const reports = await getBusinessReports(businessId);
    return c.json({ success: true, data: reports });
  } catch (err) {
    return handleError(c, err);
  }
});

dashboardRouter.get('/reports/:id', async (c) => {
  try {
    const report = await getReport(c.req.param('id'));
    if (!report) throw new NotFoundError('Report');

    // Return HTML if Accept header prefers it
    const accept = c.req.header('Accept') || '';
    if (accept.includes('text/html') && report.html_content) {
      return c.html(report.html_content);
    }

    return c.json({ success: true, data: report });
  } catch (err) {
    return handleError(c, err);
  }
});

dashboardRouter.post('/generate-report', async (c) => {
  try {
    const body = await c.req.json() as any;
    if (!body.business_id) throw new ValidationError('business_id is required');

    const db = getDb();
    const [businessRow] = await db`SELECT * FROM businesses WHERE id = ${body.business_id}`;
    if (!businessRow) throw new NotFoundError('Business');

    const business = businessRow as Business;
    const report = await generateReport(business, body.title);

    if (body.send_email) {
      sendReportEmail(business, report).catch(err =>
        console.error('[dashboard] Report email failed:', err),
      );
    }

    return c.json({ success: true, data: report }, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── Dashboard HTML ───────────────────────────────────────────────────────────

function renderDashboardPage(stats: { total: number; by_category: Record<string, number>; by_impact: Record<string, number> }): string {
  const categoryOptions = Object.keys(stats.by_category)
    .sort()
    .map(c => `<option value="${c}">${c} (${stats.by_category[c]})</option>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard — Revenue Intelligence Suite</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: #6366f1; --primary-dark: #4f46e5; --secondary: #8b5cf6;
      --bg: #0f172a; --surface: #1e293b; --surface2: #334155;
      --text: #f1f5f9; --muted: #94a3b8; --border: #334155;
      --success: #22c55e; --warning: #f59e0b; --danger: #ef4444;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    a { color: var(--primary); text-decoration: none; }

    /* Layout */
    .topbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; border-bottom: 1px solid var(--border); background: var(--surface); position: sticky; top: 0; z-index: 100; }
    .brand { font-size: 16px; font-weight: 700; color: var(--primary); }
    .topbar-nav { display: flex; gap: 16px; align-items: center; }
    .topbar-nav a { color: var(--muted); font-size: 14px; }
    .topbar-nav a:hover { color: var(--text); }
    .main { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 57px); }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 24px 16px; }
    .content { padding: 32px; overflow-y: auto; }

    /* Sidebar filters */
    .sidebar h3 { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; margin-bottom: 12px; margin-top: 24px; }
    .sidebar h3:first-child { margin-top: 0; }
    .filter-group { margin-bottom: 8px; }
    .filter-group label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); cursor: pointer; padding: 6px 8px; border-radius: 6px; transition: background .1s; }
    .filter-group label:hover { background: var(--surface2); color: var(--text); }
    .filter-group input[type=radio], .filter-group input[type=checkbox] { accent-color: var(--primary); }
    .search-box { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: var(--text); font-size: 14px; outline: none; margin-bottom: 16px; }
    .search-box:focus { border-color: var(--primary); }
    select.filter-select { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; color: var(--text); font-size: 13px; outline: none; margin-bottom: 8px; }
    select.filter-select:focus { border-color: var(--primary); }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; border: none; transition: all .15s; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-dark); }
    .btn-sm { padding: 6px 12px; font-size: 12px; }
    .btn-outline { background: transparent; color: var(--text); border: 1px solid var(--border); }
    .btn-outline:hover { border-color: var(--primary); color: var(--primary); }
    .reset-btn { width: 100%; margin-top: 8px; justify-content: center; }

    /* Stats bar */
    .stats-bar { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat-chip { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 20px; }
    .stat-chip .value { font-size: 22px; font-weight: 700; color: var(--primary); }
    .stat-chip .label { font-size: 11px; color: var(--muted); margin-top: 2px; }

    /* API grid */
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .section-header h2 { font-size: 18px; font-weight: 600; }
    .api-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .api-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; transition: border-color .2s, transform .1s; cursor: pointer; }
    .api-card:hover { border-color: var(--primary); transform: translateY(-1px); }
    .api-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; gap: 8px; }
    .api-name { font-size: 14px; font-weight: 600; line-height: 1.3; flex: 1; }
    .impact-badge { flex-shrink: 0; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; }
    .impact-High   { background: rgba(239,68,68,.15);  color: #f87171; }
    .impact-Medium { background: rgba(245,158,11,.15); color: #fbbf24; }
    .impact-Low    { background: rgba(148,163,184,.15); color: #94a3b8; }
    .api-desc { font-size: 12px; color: var(--muted); line-height: 1.5; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .api-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
    .tag { background: var(--surface2); border-radius: 4px; padding: 2px 6px; font-size: 11px; color: var(--muted); }
    .api-card-footer { display: flex; justify-content: space-between; align-items: center; }
    .category-label { font-size: 11px; color: var(--muted); }
    .api-link { font-size: 12px; color: var(--primary); font-weight: 600; }

    /* Pagination */
    .pagination { display: flex; gap: 8px; justify-content: center; margin-top: 32px; align-items: center; }
    .page-btn { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 16px; color: var(--text); cursor: pointer; font-size: 13px; }
    .page-btn:hover { border-color: var(--primary); color: var(--primary); }
    .page-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }
    .page-info { color: var(--muted); font-size: 13px; }

    /* Loading */
    .loading { text-align: center; padding: 60px; color: var(--muted); }
    .spinner { display: inline-block; width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin .8s linear infinite; margin-bottom: 12px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 200; display: none; align-items: center; justify-content: center; padding: 20px; }
    .modal-overlay.open { display: flex; }
    .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 32px; max-width: 600px; width: 100%; max-height: 80vh; overflow-y: auto; }
    .modal h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .modal-close { float: right; background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; margin-top: -4px; }
    .modal-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .modal-desc { color: var(--muted); font-size: 14px; line-height: 1.6; margin-bottom: 20px; }
    .modal-section h4 { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
    .use-case-list { list-style: none; }
    .use-case-list li { padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--border); color: var(--muted); }
    .use-case-list li::before { content: '→ '; color: var(--primary); }
    .modal-actions { display: flex; gap: 12px; margin-top: 24px; }

    @media (max-width: 768px) {
      .main { grid-template-columns: 1fr; }
      .sidebar { display: none; }
      .content { padding: 16px; }
    }
  </style>
</head>
<body>

<div class="topbar">
  <div class="brand">⚡ Revenue Intelligence Suite</div>
  <div class="topbar-nav">
    <a href="/">Home</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/admin/health">Status</a>
  </div>
</div>

<div class="main">
  <!-- Sidebar -->
  <aside class="sidebar">
    <input type="text" class="search-box" id="searchInput" placeholder="Search APIs…" />

    <h3>Category</h3>
    <select class="filter-select" id="categoryFilter">
      <option value="">All Categories</option>
      ${categoryOptions}
    </select>

    <h3>Industry</h3>
    <select class="filter-select" id="industryFilter">
      <option value="">All Industries</option>
      <option value="Local Services">Local Services</option>
      <option value="Ecommerce">Ecommerce</option>
      <option value="SaaS">SaaS</option>
      <option value="Real Estate">Real Estate</option>
      <option value="Healthcare">Healthcare</option>
      <option value="Finance">Finance</option>
      <option value="Travel">Travel</option>
      <option value="Media">Media</option>
      <option value="Education">Education</option>
    </select>

    <h3>Revenue Lever</h3>
    <div class="filter-group"><label><input type="radio" name="lever" value=""> All Levers</label></div>
    <div class="filter-group"><label><input type="radio" name="lever" value="Revenue Growth"> Revenue Growth</label></div>
    <div class="filter-group"><label><input type="radio" name="lever" value="Cost Savings"> Cost Savings</label></div>
    <div class="filter-group"><label><input type="radio" name="lever" value="Revenue Protection"> Revenue Protection</label></div>

    <h3>Impact Level</h3>
    <div class="filter-group"><label><input type="radio" name="impact" value=""> All Levels</label></div>
    <div class="filter-group"><label><input type="radio" name="impact" value="High"> 🔴 High</label></div>
    <div class="filter-group"><label><input type="radio" name="impact" value="Medium"> 🟡 Medium</label></div>
    <div class="filter-group"><label><input type="radio" name="impact" value="Low"> ⚪ Low</label></div>

    <button class="btn btn-outline reset-btn" id="resetFilters">Reset Filters</button>
  </aside>

  <!-- Main content -->
  <main class="content">
    <div class="stats-bar">
      <div class="stat-chip"><div class="value">${stats.total.toLocaleString()}</div><div class="label">Total APIs</div></div>
      <div class="stat-chip"><div class="value">${stats.by_impact.High?.toLocaleString() || 0}</div><div class="label">High Impact</div></div>
      <div class="stat-chip"><div class="value">18</div><div class="label">Categories</div></div>
      <div class="stat-chip"><div class="value" id="filteredCount">—</div><div class="label">Filtered Results</div></div>
    </div>

    <div class="section-header">
      <h2 id="resultsTitle">All APIs</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" id="viewSolutions">💡 Get Recommendations</button>
      </div>
    </div>

    <div id="apiGrid" class="api-grid">
      <div class="loading"><div class="spinner"></div><div>Loading API catalog…</div></div>
    </div>

    <div class="pagination" id="pagination"></div>
  </main>
</div>

<!-- API Detail Modal -->
<div class="modal-overlay" id="modalOverlay">
  <div class="modal">
    <button class="modal-close" id="modalClose">✕</button>
    <h2 id="modalName"></h2>
    <div class="modal-meta" id="modalMeta"></div>
    <p class="modal-desc" id="modalDesc"></p>
    <div class="modal-section">
      <h4>Use Cases</h4>
      <ul class="use-case-list" id="modalUseCases"></ul>
    </div>
    <div class="modal-actions">
      <a id="modalLink" href="#" target="_blank" class="btn btn-primary">View API →</a>
      <a id="modalAffLink" href="#" target="_blank" class="btn btn-outline">Affiliate Link</a>
    </div>
  </div>
</div>

<script>
let currentPage = 1;
let currentFilters = {};
let debounceTimer;

async function loadApis(page = 1) {
  const grid = document.getElementById('apiGrid');
  grid.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading…</div></div>';

  const params = new URLSearchParams({ page, limit: 24, ...currentFilters });
  Object.keys(currentFilters).forEach(k => !currentFilters[k] && params.delete(k));

  try {
    const res = await fetch('/dashboard/apis?' + params);
    const json = await res.json();

    document.getElementById('filteredCount').textContent = json.total?.toLocaleString() || '0';
    document.getElementById('resultsTitle').textContent =
      currentFilters.search ? \`Results for "\${currentFilters.search}"\` : 'All APIs';

    if (!json.data?.length) {
      grid.innerHTML = '<div class="loading">No APIs found matching your filters.</div>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    grid.innerHTML = json.data.map(api => \`
      <div class="api-card" onclick="openModal(\${JSON.stringify(api).replace(/"/g, '&quot;')})">
        <div class="api-card-header">
          <div class="api-name">\${api.name}</div>
          <span class="impact-badge impact-\${api.impact_level}">\${api.impact_level}</span>
        </div>
        <div class="api-desc">\${api.description}</div>
        <div class="api-tags">
          \${api.revenue_levers.slice(0,2).map(l => \`<span class="tag">\${l}</span>\`).join('')}
          \${api.data_sources.slice(0,2).map(s => \`<span class="tag">\${s}</span>\`).join('')}
        </div>
        <div class="api-card-footer">
          <span class="category-label">\${api.category}</span>
          <a href="\${api.affiliate_url}" target="_blank" class="api-link" onclick="event.stopPropagation()">View →</a>
        </div>
      </div>
    \`).join('');

    renderPagination(json.total, page, 24);
    currentPage = page;
  } catch (err) {
    grid.innerHTML = '<div class="loading">Error loading APIs. Please try again.</div>';
  }
}

function renderPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  let html = '';
  if (page > 1) html += \`<button class="page-btn" onclick="loadApis(\${page-1})">← Prev</button>\`;
  html += \`<span class="page-info">Page \${page} of \${totalPages}</span>\`;
  if (page < totalPages) html += \`<button class="page-btn" onclick="loadApis(\${page+1})">Next →</button>\`;
  pag.innerHTML = html;
}

function openModal(api) {
  document.getElementById('modalName').textContent = api.name;
  document.getElementById('modalDesc').textContent = api.description;
  document.getElementById('modalMeta').innerHTML = [
    \`<span class="tag">\${api.category}</span>\`,
    \`<span class="impact-badge impact-\${api.impact_level}">\${api.impact_level} Impact</span>\`,
    ...api.revenue_levers.map(l => \`<span class="tag">\${l}</span>\`),
  ].join('');
  document.getElementById('modalUseCases').innerHTML =
    (api.use_cases || []).map(uc => \`<li>\${uc}</li>\`).join('') || '<li>General business intelligence</li>';
  document.getElementById('modalLink').href = api.url;
  document.getElementById('modalAffLink').href = api.affiliate_url;
  document.getElementById('modalOverlay').classList.add('open');
}

document.getElementById('modalClose').onclick = () =>
  document.getElementById('modalOverlay').classList.remove('open');
document.getElementById('modalOverlay').onclick = (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
};

// Filters
function getFilters() {
  return {
    search:   document.getElementById('searchInput').value.trim(),
    category: document.getElementById('categoryFilter').value,
    industry: document.getElementById('industryFilter').value,
    lever:    document.querySelector('input[name=lever]:checked')?.value || '',
    impact:   document.querySelector('input[name=impact]:checked')?.value || '',
  };
}

document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { currentFilters = getFilters(); loadApis(1); }, 400);
});

['categoryFilter', 'industryFilter'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    currentFilters = getFilters(); loadApis(1);
  });
});

document.querySelectorAll('input[name=lever], input[name=impact]').forEach(el => {
  el.addEventListener('change', () => { currentFilters = getFilters(); loadApis(1); });
});

document.getElementById('resetFilters').onclick = () => {
  document.getElementById('searchInput').value = '';
  document.getElementById('categoryFilter').value = '';
  document.getElementById('industryFilter').value = '';
  document.querySelectorAll('input[name=lever], input[name=impact]').forEach(el => {
    if (el.value === '') el.checked = true;
  });
  currentFilters = {};
  loadApis(1);
};

document.getElementById('viewSolutions').onclick = async () => {
  const industry = document.getElementById('industryFilter').value || 'SaaS';
  window.location.href = '/dashboard/apis?industry=' + encodeURIComponent(industry) + '&impact=High';
};

// Initial load
loadApis(1);
</script>
</body>
</html>`;
}
