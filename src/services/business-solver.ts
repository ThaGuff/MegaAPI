import type {
  ApiEntry,
  Business,
  BusinessSolution,
  Industry,
  RevenueLever,
  ImpactLevel,
  ScoredSolution,
  ScoringWeights,
} from '../types';
import { scanAllApis } from './api-scanner';
import { getDb } from '../db/client';

// ─── Scoring configuration ────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: ScoringWeights = {
  fit: 0.30,
  urgency: 0.20,
  market_gap: 0.20,
  commercial_value: 0.20,
  ease_of_execution: 0.10,
};

// Industry → recommended API categories (ordered by priority)
const INDUSTRY_CATEGORY_MAP: Record<Industry, string[]> = {
  'Local Services':  ['Lead Generation', 'SEO Tools', 'Ecommerce', 'Social Media'],
  'Ecommerce':       ['Ecommerce', 'Lead Generation', 'Social Media', 'SEO Tools'],
  'SaaS':            ['Lead Generation', 'Automation', 'SEO Tools', 'Social Media'],
  'Real Estate':     ['Real Estate', 'Lead Generation', 'SEO Tools'],
  'Healthcare':      ['Lead Generation', 'SEO Tools', 'Social Media'],
  'Finance':         ['Lead Generation', 'SEO Tools', 'Automation'],
  'Travel':          ['Travel', 'SEO Tools', 'Social Media', 'Ecommerce'],
  'Media':           ['Social Media', 'Videos', 'SEO Tools', 'AI'],
  'Education':       ['Lead Generation', 'Social Media', 'SEO Tools', 'AI'],
  'Other':           ['Lead Generation', 'SEO Tools', 'Automation'],
};

// Revenue lever → impact estimate multiplier
const LEVER_IMPACT: Record<RevenueLever, { impact: number; savings: number }> = {
  'Revenue Growth':     { impact: 15000, savings: 0 },
  'Cost Savings':       { impact: 0,     savings: 5000 },
  'Revenue Protection': { impact: 8000,  savings: 3000 },
};

// Impact level → score boost
const IMPACT_SCORE_BOOST: Record<ImpactLevel, number> = {
  High:   30,
  Medium: 15,
  Low:    5,
};

// ─── Scoring algorithm ────────────────────────────────────────────────────────

function scoreApi(
  api: ApiEntry,
  industry: Industry,
  goals: string[],
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  const preferredCategories = INDUSTRY_CATEGORY_MAP[industry] || [];
  const categoryRank = preferredCategories.indexOf(api.category);

  // Fit score: how well the API category matches the industry
  const fitRaw = categoryRank === -1 ? 20 : Math.max(0, 100 - categoryRank * 20);

  // Urgency: high-impact APIs score higher
  const urgencyRaw = IMPACT_SCORE_BOOST[api.impact_level];

  // Market gap: APIs with multiple revenue levers fill more gaps
  const marketGapRaw = Math.min(100, api.revenue_levers.length * 35);

  // Commercial value: estimate based on lever type
  const primaryLever = api.revenue_levers[0] || 'Revenue Growth';
  const leverData = LEVER_IMPACT[primaryLever];
  const commercialRaw = Math.min(100, ((leverData.impact + leverData.savings) / 200));

  // Ease of execution: shorter descriptions = simpler APIs
  const easeRaw = api.description.length < 150 ? 80 : api.description.length < 300 ? 60 : 40;

  // Goal alignment bonus
  const goalBonus = goals.some(g =>
    api.use_cases.some(uc => uc.toLowerCase().includes(g.toLowerCase())) ||
    api.tags.some(t => t.toLowerCase().includes(g.toLowerCase())),
  )
    ? 10
    : 0;

  const raw =
    fitRaw * weights.fit +
    urgencyRaw * weights.urgency +
    marketGapRaw * weights.market_gap +
    commercialRaw * weights.commercial_value +
    easeRaw * weights.ease_of_execution;

  return Math.min(100, Math.round(raw + goalBonus));
}

// ─── Impact estimation ────────────────────────────────────────────────────────

function estimateImpact(
  api: ApiEntry,
  industry: Industry,
): { impact: number; savings: number } {
  const base = LEVER_IMPACT[api.revenue_levers[0] || 'Revenue Growth'];

  // Industry multipliers
  const multipliers: Record<Industry, number> = {
    'SaaS':           1.8,
    'Ecommerce':      1.5,
    'Local Services': 1.2,
    'Real Estate':    1.6,
    'Healthcare':     1.3,
    'Finance':        2.0,
    'Travel':         1.4,
    'Media':          1.1,
    'Education':      1.0,
    'Other':          1.0,
  };

  const mult = multipliers[industry] || 1.0;
  const impactVariance = 0.8 + Math.random() * 0.4; // ±20% variance

  return {
    impact:  Math.round(base.impact  * mult * impactVariance),
    savings: Math.round(base.savings * mult * impactVariance),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate scored solution recommendations for a business.
 */
export async function recommendSolutions(params: {
  industry: Industry;
  goals: string[];
  budget?: number;
  limit?: number;
}): Promise<ScoredSolution[]> {
  const { industry, goals, limit = 20 } = params;
  const allApis = await scanAllApis();

  // Filter to relevant APIs
  const preferredCategories = INDUSTRY_CATEGORY_MAP[industry] || [];
  const relevant = allApis.filter(api => {
    // Must match industry or be in a preferred category
    const industryMatch = api.industries.includes(industry) || api.industries.includes('Other');
    const categoryMatch = preferredCategories.includes(api.category);
    return industryMatch || categoryMatch;
  });

  // Score each API
  const scored = relevant.map(api => {
    const score = scoreApi(api, industry, goals);
    const { impact, savings } = estimateImpact(api, industry);
    const primaryUseCase = api.use_cases[0] || `Use ${api.name} for ${industry} intelligence`;

    return {
      api,
      use_case: primaryUseCase,
      impact_estimate: impact,
      savings_estimate: savings,
      score,
      reasoning: buildReasoning(api, industry, score),
    } satisfies ScoredSolution;
  });

  // Sort by score descending, deduplicate by name prefix
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate similar APIs (same first 3 words in name)
  const seen = new Set<string>();
  const deduped: ScoredSolution[] = [];
  for (const s of scored) {
    const key = s.api.name.split(' ').slice(0, 3).join(' ').toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }

  return deduped.slice(0, limit);
}

function buildReasoning(api: ApiEntry, industry: Industry, score: number): string {
  const lever = api.revenue_levers[0] || 'Revenue Growth';
  const impact = api.impact_level;
  const category = api.category;

  if (score >= 80) {
    return `Top-tier match for ${industry} businesses. ${impact} impact ${lever.toLowerCase()} tool in the ${category} category.`;
  } else if (score >= 60) {
    return `Strong fit for ${industry}. Supports ${lever.toLowerCase()} with ${impact.toLowerCase()} impact.`;
  } else {
    return `Supplementary tool for ${industry} ${lever.toLowerCase()} initiatives.`;
  }
}

/**
 * Save a solution to the database.
 */
export async function saveSolution(params: {
  business_id: string;
  api_id: string;
  use_case: string;
  impact_estimate: number;
  savings_estimate: number;
  score: number;
}): Promise<BusinessSolution> {
  const db = getDb();
  const [row] = await db`
    INSERT INTO business_solutions
      (business_id, api_id, use_case, impact_estimate, savings_estimate, score)
    VALUES
      (${params.business_id}, ${params.api_id}, ${params.use_case},
       ${params.impact_estimate}, ${params.savings_estimate}, ${params.score})
    RETURNING *
  `;
  return row as BusinessSolution;
}

/**
 * Get all solutions for a business.
 */
export async function getBusinessSolutions(businessId: string): Promise<BusinessSolution[]> {
  const db = getDb();
  const rows = await db`
    SELECT bs.*, ac.name as api_name, ac.category, ac.description, ac.affiliate_url
    FROM business_solutions bs
    JOIN api_catalog ac ON ac.id = bs.api_id
    WHERE bs.business_id = ${businessId}
    ORDER BY bs.score DESC
  `;
  return rows as BusinessSolution[];
}

/**
 * Update solution status.
 */
export async function updateSolutionStatus(
  solutionId: string,
  status: BusinessSolution['status'],
  notes?: string,
): Promise<BusinessSolution> {
  const db = getDb();
  const [row] = await db`
    UPDATE business_solutions
    SET status = ${status}, notes = ${notes ?? null}
    WHERE id = ${solutionId}
    RETURNING *
  `;
  return row as BusinessSolution;
}

/**
 * Get solution statistics for a business.
 */
export async function getSolutionStats(businessId: string): Promise<{
  total: number;
  by_status: Record<string, number>;
  total_impact: number;
  total_savings: number;
}> {
  const db = getDb();
  const rows = await db`
    SELECT
      COUNT(*)::int                                    AS total,
      SUM(impact_estimate)::numeric                    AS total_impact,
      SUM(savings_estimate)::numeric                   AS total_savings,
      COUNT(*) FILTER (WHERE status = 'recommended')::int  AS recommended,
      COUNT(*) FILTER (WHERE status = 'in_progress')::int  AS in_progress,
      COUNT(*) FILTER (WHERE status = 'implemented')::int  AS implemented,
      COUNT(*) FILTER (WHERE status = 'dismissed')::int    AS dismissed
    FROM business_solutions
    WHERE business_id = ${businessId}
  `;

  const r = rows[0] as any;
  return {
    total:         r.total || 0,
    total_impact:  Number(r.total_impact) || 0,
    total_savings: Number(r.total_savings) || 0,
    by_status: {
      recommended: r.recommended || 0,
      in_progress: r.in_progress || 0,
      implemented: r.implemented || 0,
      dismissed:   r.dismissed   || 0,
    },
  };
}
