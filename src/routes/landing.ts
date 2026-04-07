import { Hono } from 'hono';
import { getDb } from '../db/client';
import { sendWelcomeEmail } from '../services/email-service';
import { bootstrapBusinessJobs } from '../services/scheduler';
import { validateRegisterRequest } from '../utils/validators';
import { handleError } from '../middleware/error';
import type { Business, ApiResponse, RegisterBusinessResponse } from '../types';

export const landingRouter = new Hono();

// ─── Landing page ─────────────────────────────────────────────────────────────

landingRouter.get('/', (c) => {
  const html = renderLandingPage();
  return c.html(html);
});

landingRouter.get('/pricing', (c) => {
  return c.html(renderPricingPage());
});

landingRouter.get('/features', (c) => {
  return c.html(renderFeaturesPage());
});

// ─── Registration ─────────────────────────────────────────────────────────────

landingRouter.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const validated = validateRegisterRequest(body);

    const db = getDb();

    // Check for existing email
    const [existing] = await db`SELECT id FROM businesses WHERE email = ${validated.email}`;
    if (existing) {
      return c.json<ApiResponse>({ success: false, error: 'An account with this email already exists' }, 409);
    }

    // Create business
    const [business] = await db`
      INSERT INTO businesses (name, email, industry, website, region, plan)
      VALUES (${validated.name}, ${validated.email}, ${validated.industry},
              ${validated.website ?? null}, ${validated.region ?? null}, ${validated.plan})
      RETURNING *
    ` as Business[];

    // Create subscription
    const frequencyMap: Record<string, string> = {
      starter: 'monthly',
      growth:  'weekly',
      premium: 'daily',
    };
    const frequency = frequencyMap[validated.plan] || 'monthly';

    await db`
      INSERT INTO subscriptions (business_id, plan, frequency)
      VALUES (${business.id}, ${validated.plan}, ${frequency})
    `;

    // Bootstrap scheduled jobs
    try {
      await bootstrapBusinessJobs(business.id, frequency);
    } catch (err) {
      console.warn('[register] Could not bootstrap jobs:', err);
    }

    // Send welcome email (non-blocking)
    sendWelcomeEmail(business).catch(err =>
      console.error('[register] Welcome email failed:', err),
    );

    const response: RegisterBusinessResponse = {
      success:  true,
      business: { ...business, api_key: business.api_key },
      api_key:  business.api_key,
      message:  'Account created successfully. Check your email for your API key.',
    };

    return c.json(response, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

// ─── HTML templates ───────────────────────────────────────────────────────────

function renderLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Revenue Intelligence Suite — Turn APIs into Business Growth</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: #6366f1; --primary-dark: #4f46e5; --secondary: #8b5cf6;
      --bg: #0f172a; --surface: #1e293b; --surface2: #334155;
      --text: #f1f5f9; --muted: #94a3b8; --border: #334155;
      --success: #22c55e; --warning: #f59e0b; --danger: #ef4444;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Nav */
    nav { display: flex; justify-content: space-between; align-items: center; padding: 20px 40px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(15,23,42,.95); backdrop-filter: blur(12px); z-index: 100; }
    .nav-brand { font-size: 18px; font-weight: 700; color: var(--primary); }
    .nav-links { display: flex; gap: 24px; align-items: center; }
    .nav-links a { color: var(--muted); font-size: 14px; }
    .nav-links a:hover { color: var(--text); text-decoration: none; }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; border: none; transition: all .15s; text-decoration: none; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-dark); text-decoration: none; }
    .btn-outline { background: transparent; color: var(--text); border: 1px solid var(--border); }
    .btn-outline:hover { border-color: var(--primary); color: var(--primary); text-decoration: none; }
    .btn-lg { padding: 14px 28px; font-size: 16px; border-radius: 10px; }

    /* Hero */
    .hero { text-align: center; padding: 100px 40px 80px; max-width: 900px; margin: 0 auto; }
    .hero-badge { display: inline-block; background: rgba(99,102,241,.15); color: var(--primary); border: 1px solid rgba(99,102,241,.3); border-radius: 9999px; padding: 6px 16px; font-size: 13px; font-weight: 600; margin-bottom: 24px; }
    .hero h1 { font-size: clamp(36px, 6vw, 64px); font-weight: 800; line-height: 1.1; margin-bottom: 24px; background: linear-gradient(135deg, #f1f5f9, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero h1 span { background: linear-gradient(135deg, var(--primary), var(--secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { font-size: 18px; color: var(--muted); max-width: 600px; margin: 0 auto 40px; }
    .hero-ctas { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
    .hero-stats { display: flex; gap: 40px; justify-content: center; margin-top: 60px; flex-wrap: wrap; }
    .hero-stat { text-align: center; }
    .hero-stat .value { font-size: 32px; font-weight: 800; color: var(--primary); }
    .hero-stat .label { font-size: 13px; color: var(--muted); margin-top: 4px; }

    /* Features */
    .section { padding: 80px 40px; max-width: 1200px; margin: 0 auto; }
    .section-header { text-align: center; margin-bottom: 60px; }
    .section-header h2 { font-size: 36px; font-weight: 700; margin-bottom: 12px; }
    .section-header p { color: var(--muted); font-size: 16px; max-width: 500px; margin: 0 auto; }
    .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
    .feature-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 28px; transition: border-color .2s; }
    .feature-card:hover { border-color: var(--primary); }
    .feature-icon { font-size: 32px; margin-bottom: 16px; }
    .feature-card h3 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .feature-card p { color: var(--muted); font-size: 14px; line-height: 1.6; }

    /* Categories */
    .categories { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 40px; }
    .category-chip { background: var(--surface); border: 1px solid var(--border); border-radius: 9999px; padding: 6px 14px; font-size: 13px; color: var(--muted); }

    /* Pricing */
    .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; max-width: 900px; margin: 0 auto; }
    .pricing-card { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 32px; position: relative; }
    .pricing-card.featured { border-color: var(--primary); background: linear-gradient(135deg, rgba(99,102,241,.1), rgba(139,92,246,.05)); }
    .pricing-badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--primary); color: #fff; border-radius: 9999px; padding: 4px 16px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .pricing-plan { font-size: 14px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
    .pricing-price { font-size: 48px; font-weight: 800; margin-bottom: 4px; }
    .pricing-price span { font-size: 16px; font-weight: 400; color: var(--muted); }
    .pricing-desc { color: var(--muted); font-size: 14px; margin-bottom: 24px; }
    .pricing-features { list-style: none; margin-bottom: 28px; }
    .pricing-features li { padding: 8px 0; font-size: 14px; color: var(--muted); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
    .pricing-features li::before { content: '✓'; color: var(--success); font-weight: 700; }

    /* Registration form */
    .register-section { background: var(--surface); border: 1px solid var(--border); border-radius: 24px; padding: 48px; max-width: 560px; margin: 0 auto; }
    .register-section h2 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .register-section p { color: var(--muted); margin-bottom: 32px; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .05em; }
    .form-group input, .form-group select { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; color: var(--text); font-size: 15px; outline: none; transition: border-color .15s; }
    .form-group input:focus, .form-group select:focus { border-color: var(--primary); }
    .form-group select option { background: var(--surface); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    #registerBtn { width: 100%; margin-top: 8px; justify-content: center; }
    #registerResult { margin-top: 16px; padding: 16px; border-radius: 8px; font-size: 14px; display: none; }
    #registerResult.success { background: rgba(34,197,94,.1); border: 1px solid rgba(34,197,94,.3); color: var(--success); }
    #registerResult.error { background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); color: var(--danger); }
    .api-key-display { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-family: monospace; font-size: 12px; word-break: break-all; margin-top: 8px; }

    /* Footer */
    footer { border-top: 1px solid var(--border); padding: 40px; text-align: center; color: var(--muted); font-size: 13px; }
    footer a { color: var(--muted); }

    @media (max-width: 640px) {
      nav { padding: 16px 20px; }
      .hero { padding: 60px 20px 40px; }
      .section { padding: 60px 20px; }
      .form-row { grid-template-columns: 1fr; }
      .register-section { padding: 32px 20px; }
    }
  </style>
</head>
<body>

<nav>
  <div class="nav-brand">⚡ Revenue Intelligence Suite</div>
  <div class="nav-links">
    <a href="/features">Features</a>
    <a href="/pricing">Pricing</a>
    <a href="/dashboard">Dashboard</a>
    <a href="#register" class="btn btn-primary">Get Started Free</a>
  </div>
</nav>

<!-- Hero -->
<section class="hero">
  <div class="hero-badge">🚀 10,498+ APIs across 18 categories</div>
  <h1>Turn <span>API Intelligence</span> into Business Growth</h1>
  <p>Discover, filter, and implement the right APIs for your business. Get scheduled intelligence reports delivered to your inbox.</p>
  <div class="hero-ctas">
    <a href="#register" class="btn btn-primary btn-lg">Start Free Trial →</a>
    <a href="/dashboard" class="btn btn-outline btn-lg">Explore Dashboard</a>
  </div>
  <div class="hero-stats">
    <div class="hero-stat"><div class="value">10,498+</div><div class="label">APIs Catalogued</div></div>
    <div class="hero-stat"><div class="value">18</div><div class="label">Categories</div></div>
    <div class="hero-stat"><div class="value">3</div><div class="label">Revenue Levers</div></div>
    <div class="hero-stat"><div class="value">∞</div><div class="label">Business Insights</div></div>
  </div>
</section>

<!-- Features -->
<section class="section">
  <div class="section-header">
    <h2>Everything you need to grow</h2>
    <p>From API discovery to scheduled reports — one platform for all your intelligence needs.</p>
  </div>
  <div class="features-grid">
    <div class="feature-card">
      <div class="feature-icon">🔍</div>
      <h3>Smart API Discovery</h3>
      <p>Browse 10,498+ APIs filtered by industry, revenue lever, data source, and impact level. Find exactly what your business needs.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">🎯</div>
      <h3>Business Solution Matching</h3>
      <p>Our scoring algorithm matches APIs to your specific business goals — revenue growth, cost savings, or revenue protection.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">📊</div>
      <h3>Interactive Dashboard</h3>
      <p>Visualise opportunities, leads, pricing signals, reviews, SEO demand, and creative intelligence in one place.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">📧</div>
      <h3>Scheduled Reports</h3>
      <p>Receive branded HTML reports via email on your schedule — daily, weekly, or monthly. Never miss an opportunity.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">⚡</div>
      <h3>Real-time Scoring</h3>
      <p>Every API is scored using a weighted algorithm: fit × urgency × market gap × commercial value × ease of execution.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">🔒</div>
      <h3>Secure & Scalable</h3>
      <p>API key authentication, JWT tokens, PostgreSQL backend, and production-ready error handling built in from day one.</p>
    </div>
  </div>
  <div class="categories">
    ${['Lead Generation', 'Ecommerce', 'SEO Tools', 'Social Media', 'Automation', 'AI', 'Developer Tools', 'Jobs', 'News', 'Real Estate', 'Travel', 'Videos', 'Open Source', 'Integrations', 'MCP Servers', 'Agents', 'Business', 'Other'].map(c => `<span class="category-chip">${c}</span>`).join('')}
  </div>
</section>

<!-- Pricing -->
<section class="section" id="pricing">
  <div class="section-header">
    <h2>Simple, transparent pricing</h2>
    <p>Start free, scale as you grow. No hidden fees.</p>
  </div>
  <div class="pricing-grid">
    <div class="pricing-card">
      <div class="pricing-plan">Starter</div>
      <div class="pricing-price">$299<span>/mo</span></div>
      <div class="pricing-desc">Perfect for solo operators and small businesses.</div>
      <ul class="pricing-features">
        <li>1 business dashboard</li>
        <li>Monthly intelligence report</li>
        <li>2 intelligence modules</li>
        <li>API catalog access</li>
        <li>Email delivery</li>
      </ul>
      <a href="#register" class="btn btn-outline" style="width:100%;justify-content:center">Get Started</a>
    </div>
    <div class="pricing-card featured">
      <div class="pricing-badge">Most Popular</div>
      <div class="pricing-plan">Growth</div>
      <div class="pricing-price">$799<span>/mo</span></div>
      <div class="pricing-desc">For growing businesses that need deeper intelligence.</div>
      <ul class="pricing-features">
        <li>3 markets / locations</li>
        <li>Weekly reports</li>
        <li>4 intelligence modules</li>
        <li>Competitor tracking</li>
        <li>Priority email support</li>
      </ul>
      <a href="#register" class="btn btn-primary" style="width:100%;justify-content:center">Get Started</a>
    </div>
    <div class="pricing-card">
      <div class="pricing-plan">Premium</div>
      <div class="pricing-price">$2,000<span>/mo</span></div>
      <div class="pricing-desc">For agencies and multi-location enterprises.</div>
      <ul class="pricing-features">
        <li>Unlimited markets</li>
        <li>Daily reports + alerts</li>
        <li>All intelligence modules</li>
        <li>Custom integrations</li>
        <li>Dedicated account manager</li>
      </ul>
      <a href="#register" class="btn btn-outline" style="width:100%;justify-content:center">Contact Sales</a>
    </div>
  </div>
</section>

<!-- Registration -->
<section class="section" id="register">
  <div class="register-section">
    <h2>Start your free trial</h2>
    <p>No credit card required. Get your API key instantly.</p>
    <form id="registerForm">
      <div class="form-row">
        <div class="form-group">
          <label>Business Name</label>
          <input type="text" name="name" placeholder="Acme Corp" required />
        </div>
        <div class="form-group">
          <label>Work Email</label>
          <input type="email" name="email" placeholder="you@company.com" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Industry</label>
          <select name="industry" required>
            <option value="">Select industry…</option>
            <option value="Local Services">Local Services</option>
            <option value="Ecommerce">Ecommerce</option>
            <option value="SaaS">SaaS</option>
            <option value="Real Estate">Real Estate</option>
            <option value="Healthcare">Healthcare</option>
            <option value="Finance">Finance</option>
            <option value="Travel">Travel</option>
            <option value="Media">Media</option>
            <option value="Education">Education</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>Plan</label>
          <select name="plan">
            <option value="starter">Starter — $299/mo</option>
            <option value="growth">Growth — $799/mo</option>
            <option value="premium">Premium — $2,000/mo</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Website (optional)</label>
        <input type="url" name="website" placeholder="https://yoursite.com" />
      </div>
      <button type="submit" class="btn btn-primary btn-lg" id="registerBtn">Create Account →</button>
    </form>
    <div id="registerResult"></div>
  </div>
</section>

<footer>
  <p>© ${new Date().getFullYear()} Revenue Intelligence Suite · <a href="/features">Features</a> · <a href="/pricing">Pricing</a> · <a href="/admin/health">Status</a></p>
</footer>

<script>
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('registerBtn');
  const result = document.getElementById('registerResult');
  btn.textContent = 'Creating account…';
  btn.disabled = true;

  const form = e.target;
  const data = {
    name:     form.name.value,
    email:    form.email.value,
    industry: form.industry.value,
    plan:     form.plan.value,
    website:  form.website.value || undefined,
  };

  try {
    const res = await fetch('/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    const json = await res.json();

    if (json.success) {
      result.className = 'success';
      result.style.display = 'block';
      result.innerHTML = '<strong>🎉 Account created!</strong><br>Your API key:<div class="api-key-display">' + json.api_key + '</div><br><a href="/dashboard" style="color:inherit;font-weight:600">Open Dashboard →</a>';
      form.reset();
    } else {
      result.className = 'error';
      result.style.display = 'block';
      result.textContent = json.error || 'Registration failed. Please try again.';
    }
  } catch (err) {
    result.className = 'error';
    result.style.display = 'block';
    result.textContent = 'Network error. Please try again.';
  } finally {
    btn.textContent = 'Create Account →';
    btn.disabled = false;
  }
});
</script>
</body>
</html>`;
}

function renderPricingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pricing — Revenue Intelligence Suite</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 40px 20px; }
    .container { max-width: 900px; margin: 0 auto; text-align: center; }
    h1 { font-size: 40px; font-weight: 800; margin-bottom: 12px; }
    p { color: #94a3b8; margin-bottom: 40px; }
    a { color: #6366f1; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Pricing</h1>
    <p>See our full pricing on the <a href="/#pricing">home page</a>.</p>
    <a href="/">← Back to home</a>
  </div>
</body>
</html>`;
}

function renderFeaturesPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Features — Revenue Intelligence Suite</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 40px 20px; }
    .container { max-width: 900px; margin: 0 auto; text-align: center; }
    h1 { font-size: 40px; font-weight: 800; margin-bottom: 12px; }
    p { color: #94a3b8; margin-bottom: 40px; }
    a { color: #6366f1; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Features</h1>
    <p>See all features on the <a href="/">home page</a>.</p>
    <a href="/">← Back to home</a>
  </div>
</body>
</html>`;
}
