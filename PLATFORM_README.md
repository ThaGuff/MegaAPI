# Revenue Intelligence Suite — Business Intelligence Platform

A production-ready SaaS platform that scans 10,498+ APIs across 18 categories, maps them to real business outcomes, and delivers scheduled intelligence reports via email.

---

## Architecture

```
src/
├── index.ts                 # Hono server, middleware, graceful shutdown
├── db/
│   ├── schema.ts            # PostgreSQL DDL (businesses, subscriptions, reports, api_catalog, solutions, jobs)
│   └── client.ts            # postgres.js connection pool + migration runner
├── services/
│   ├── api-scanner.ts       # Parses all 18 category README files → structured ApiEntry[]
│   ├── business-solver.ts   # Scoring algorithm → ranked ScoredSolution[]
│   ├── report-generator.ts  # HTML report builder + DB persistence
│   ├── email-service.ts     # Resend/SMTP with retry logic + branded templates
│   └── scheduler.ts         # DB-backed cron poller (daily/weekly/monthly)
├── routes/
│   ├── landing.ts           # GET / (landing page) + POST /register
│   ├── dashboard.ts         # GET /dashboard (interactive UI) + JSON API
│   ├── api.ts               # REST API for businesses, subscriptions, reports, jobs
│   └── admin.ts             # Health, debug, logs, metrics, catalog management
├── middleware/
│   ├── auth.ts              # JWT (HS256) + API key + admin secret
│   ├── error.ts             # Typed error classes + global handler
│   └── logging.ts           # Request logger + in-memory metrics ring buffer
├── types/
│   └── index.ts             # All TypeScript interfaces and union types
└── utils/
    ├── validators.ts        # Input validation with typed errors
    ├── formatters.ts        # Currency, date, string formatters
    └── helpers.ts           # Retry, pagination, rate limiting, env helpers
```

---

## Quick Start

### 1. Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- PostgreSQL database (Supabase recommended — free tier works)
- Resend account for email (optional but recommended)

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Random 32+ char string for JWT signing |
| `ADMIN_SECRET` | Yes | Password for admin panel |
| `RESEND_API_KEY` | No | Resend API key for email delivery |
| `EMAIL_FROM` | No | Verified sender address |
| `APP_URL` | No | Public URL (for email links) |
| `PORT` | No | HTTP port (default: 3000) |

### 4. Run in development

```bash
bun dev
```

The server starts at `http://localhost:3000`.

### 5. Seed the API catalog (optional)

```bash
bun run db:seed
```

This parses all 18 category README files and inserts the APIs into your database.

---

## Endpoints

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Landing page with registration form |
| `POST` | `/register` | Register a business, get API key |
| `GET` | `/pricing` | Pricing page |
| `GET` | `/features` | Features page |

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/dashboard` | Interactive API catalog browser |
| `GET` | `/dashboard/apis` | Filtered API list (JSON) |
| `GET` | `/dashboard/solutions` | Recommended solutions for an industry |
| `POST` | `/dashboard/solutions` | Save a solution |
| `GET` | `/dashboard/solutions/:businessId` | Business solutions |
| `PATCH` | `/dashboard/solutions/:id/status` | Update solution status |
| `GET` | `/dashboard/reports` | List reports for a business |
| `GET` | `/dashboard/reports/:id` | View report (HTML or JSON) |
| `POST` | `/dashboard/generate-report` | Generate a new report |

### REST API (`/api`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/businesses/:id` | Get business details |
| `PUT` | `/api/businesses/:id` | Update business |
| `GET` | `/api/subscriptions` | List subscriptions |
| `POST` | `/api/subscriptions` | Create subscription |
| `PUT` | `/api/subscriptions/:id` | Update subscription |
| `GET` | `/api/reports` | List reports |
| `GET` | `/api/reports/:id` | Get report |
| `POST` | `/api/reports/generate` | Generate report |
| `GET` | `/api/scheduled-jobs` | List jobs |
| `POST` | `/api/scheduled-jobs` | Create job |
| `GET` | `/api/scheduled-jobs/:id` | Get job status |
| `DELETE` | `/api/scheduled-jobs/:id` | Delete job |

### Admin (`/admin`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/health` | None | System health check |
| `GET` | `/admin` | Admin secret | Admin dashboard |
| `GET` | `/admin/debug` | Admin secret | Debug info |
| `GET` | `/admin/logs` | Admin secret | Recent request logs |
| `GET` | `/admin/metrics` | Admin secret | Performance metrics |
| `POST` | `/admin/test-email` | Admin secret | Send test email |
| `GET` | `/admin/jobs` | Admin secret | All scheduled jobs |
| `POST` | `/admin/jobs/:id/run` | Admin secret | Manually trigger job |
| `GET` | `/admin/catalog/stats` | Admin secret | API catalog statistics |
| `POST` | `/admin/catalog/refresh` | Admin secret | Refresh in-memory cache |
| `POST` | `/admin/catalog/seed` | Admin secret | Seed DB from README files |

---

## Authentication

### API Key

Include in request header:
```
X-API-Key: your-api-key-here
```

### JWT Bearer Token

```
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

### Admin Secret

```
X-Admin-Secret: your-admin-secret
```

---

## Dashboard Filters

The `/dashboard/apis` endpoint supports these query parameters:

| Param | Values | Description |
|---|---|---|
| `category` | `Lead Generation`, `Ecommerce`, `SEO Tools`, etc. | Filter by API category |
| `industry` | `Local Services`, `Ecommerce`, `SaaS`, etc. | Filter by target industry |
| `lever` | `Revenue Growth`, `Cost Savings`, `Revenue Protection` | Filter by revenue lever |
| `impact` | `High`, `Medium`, `Low` | Filter by impact level |
| `search` | any string | Full-text search on name/description/tags |
| `page` | integer | Page number (default: 1) |
| `limit` | integer (max 200) | Results per page (default: 50) |

---

## Scoring Algorithm

Each API is scored 0–100 using a weighted formula:

```
score = (fit × 0.30) + (urgency × 0.20) + (market_gap × 0.20) + (commercial_value × 0.20) + (ease × 0.10) + goal_bonus
```

- **Fit**: How well the API category matches the target industry
- **Urgency**: Based on detected impact level (High/Medium/Low)
- **Market gap**: Number of revenue levers the API addresses
- **Commercial value**: Estimated revenue impact + savings
- **Ease of execution**: Complexity proxy from description length
- **Goal bonus**: +10 if API use cases match stated business goals

---

## Database Schema

Six tables with full referential integrity:

- **businesses** — multi-tenant business accounts with API keys
- **subscriptions** — plan, status, frequency, next report date
- **reports** — generated HTML reports with JSONB data payload
- **api_catalog** — 10,498+ APIs with tags, industries, levers, use cases
- **business_solutions** — saved API recommendations per business
- **scheduled_jobs** — DB-backed cron jobs (daily/weekly/monthly)

Migrations run automatically on startup via `runMigrations()`.

---

## Email Templates

Three branded HTML email templates:

1. **Welcome email** — sent on registration with API key
2. **Report email** — monthly/weekly/daily report summary with KPIs
3. **Alert email** — threshold breach notifications

Configure `RESEND_API_KEY` and `EMAIL_FROM` to enable delivery. In development, emails are logged to console.

---

## Deployment (Railway)

1. Create a new Railway project
2. Add a PostgreSQL service
3. Deploy this repo
4. Set environment variables in Railway dashboard
5. The app auto-migrates the database on first start

```bash
# Railway will use this automatically
bun run start
```

---

## Troubleshooting

### Database connection fails
- Check `DATABASE_URL` is set correctly
- For Supabase, use the "URI" format from Project Settings → Database
- Ensure SSL is enabled for production connections

### Emails not sending
- Verify `RESEND_API_KEY` is set
- Check `EMAIL_FROM` is a verified sender in Resend
- In development, emails are logged to console (not sent)

### API catalog shows 0 results
- Run `POST /admin/catalog/refresh` to reload from README files
- Ensure the category README files exist in their folders
- Check `/admin/health` for system status

### Scheduler not running
- Set `ENABLE_SCHEDULER=true` in `.env`
- Ensure `DATABASE_URL` is configured
- Check `/admin/jobs` for job status

---

## Revenue Model

| Plan | Price | Features |
|---|---|---|
| Starter | $299/mo | 1 dashboard, monthly report, 2 modules |
| Growth | $799/mo | 3 markets, weekly reports, 4 modules, competitor tracking |
| Premium | $2,000/mo | Unlimited, daily reports, alerts, custom integrations |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Framework | Hono |
| Database | PostgreSQL (Supabase) |
| Email | Resend |
| Auth | JWT (HS256) + API keys |
| Language | TypeScript (strict) |
