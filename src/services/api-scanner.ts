import type { ApiEntry, ApiCategory, Industry, RevenueLever, ImpactLevel } from '../types';
import { getDb } from '../db/client';

// ─── Category → folder mapping ────────────────────────────────────────────────

const CATEGORY_FOLDERS: Record<ApiCategory, string> = {
  'Lead Generation':   'lead-generation-apis-3452',
  'Ecommerce':         'ecommerce-apis-2440',
  'SEO Tools':         'seo-tools-apis-710',
  'Social Media':      'social-media-apis-3268',
  'Automation':        'automation-apis-4825',
  'AI':                'ai-apis-1208',
  'Developer Tools':   'developer-tools-apis-2652',
  'Business':          'business-apis-2',
  'Jobs':              'jobs-apis-848',
  'News':              'news-apis-590',
  'Real Estate':       'real-estate-apis-851',
  'Travel':            'travel-apis-397',
  'Videos':            'videos-apis-979',
  'Open Source':       'open-source-apis-768',
  'Integrations':      'integrations-apis-890',
  'MCP Servers':       'mcp-servers-apis-131',
  'Agents':            'agents-apis-697',
  'Other':             'other-apis-1297',
};

// ─── Keyword → industry mapping ───────────────────────────────────────────────

const INDUSTRY_KEYWORDS: Record<Industry, string[]> = {
  'Local Services':  ['google maps', 'local', 'restaurant', 'dental', 'clinic', 'yelp', 'tripadvisor', 'grubhub', 'uber eats'],
  'Ecommerce':       ['amazon', 'shopify', 'ebay', 'product', 'price', 'shop', 'store', 'marketplace', 'woocommerce', 'etsy'],
  'SaaS':            ['saas', 'software', 'linkedin', 'builtwith', 'crm', 'b2b', 'lead', 'apollo', 'zoominfo', 'hubspot'],
  'Real Estate':     ['real estate', 'property', 'zillow', 'airbnb', 'immobilien', 'propertyfinder', 'immoscout'],
  'Healthcare':      ['health', 'medical', 'dental', 'pharmacy', 'doctor', 'hospital', 'clinic'],
  'Finance':         ['finance', 'finviz', 'stock', 'crypto', 'trading', 'investment', 'bank'],
  'Travel':          ['travel', 'hotel', 'flight', 'booking', 'airbnb', 'tripadvisor', 'expedia'],
  'Media':           ['youtube', 'tiktok', 'instagram', 'twitter', 'facebook', 'social', 'video', 'podcast'],
  'Education':       ['education', 'course', 'learning', 'university', 'school', 'udemy'],
  'Other':           [],
};

// ─── Keyword → revenue lever mapping ─────────────────────────────────────────

const LEVER_KEYWORDS: Record<RevenueLever, string[]> = {
  'Revenue Growth':     ['lead', 'prospect', 'outreach', 'growth', 'sales', 'marketing', 'seo', 'keyword', 'traffic', 'ad', 'creative', 'content'],
  'Cost Savings':       ['validate', 'verify', 'clean', 'hygiene', 'efficiency', 'automate', 'reduce', 'save', 'optimize'],
  'Revenue Protection': ['monitor', 'track', 'alert', 'competitor', 'price', 'review', 'sentiment', 'protect', 'defend'],
};

// ─── Keyword → impact level ───────────────────────────────────────────────────

const HIGH_IMPACT_KEYWORDS = [
  'google maps', 'linkedin', 'amazon', 'facebook ads', 'email', 'lead', 'prospect',
  'competitor', 'price', 'review', 'seo', 'keyword', 'builtwith',
];

// ─── In-memory cache ──────────────────────────────────────────────────────────

let _catalogCache: ApiEntry[] | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a markdown table row into an ApiEntry.
 * Table format: | [Name](url) | Description |
 */
function parseTableRow(line: string, category: ApiCategory): Partial<ApiEntry> | null {
  // Match: | [Name](url) | Description |
  const match = line.match(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|/);
  if (!match) return null;

  const [, rawName, url, description] = match;
  const name = rawName.replace(/[^\x20-\x7E]/g, '').trim(); // strip emoji
  const cleanDesc = description.replace(/&#124;/g, '|').trim();

  // Build affiliate URL (already has fpr= param in source data)
  const affiliateUrl = url.includes('fpr=') ? url : `${url}${url.includes('?') ? '&' : '?'}fpr=p2hrc6`;

  // Detect industries
  const lowerDesc = (name + ' ' + cleanDesc).toLowerCase();
  const industries: Industry[] = [];
  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS) as [Industry, string[]][]) {
    if (keywords.some(kw => lowerDesc.includes(kw))) {
      industries.push(industry);
    }
  }
  if (industries.length === 0) industries.push('Other');

  // Detect revenue levers
  const levers: RevenueLever[] = [];
  for (const [lever, keywords] of Object.entries(LEVER_KEYWORDS) as [RevenueLever, string[]][]) {
    if (keywords.some(kw => lowerDesc.includes(kw))) {
      levers.push(lever);
    }
  }
  if (levers.length === 0) levers.push('Revenue Growth');

  // Detect impact level
  const impactLevel: ImpactLevel = HIGH_IMPACT_KEYWORDS.some(kw => lowerDesc.includes(kw))
    ? 'High'
    : cleanDesc.length > 100
    ? 'Medium'
    : 'Low';

  // Extract data sources from name/description
  const dataSources: string[] = [];
  const sourcePatterns = [
    'Google Maps', 'Google Search', 'Google Shopping', 'LinkedIn', 'Amazon',
    'Facebook', 'Instagram', 'TikTok', 'Twitter', 'YouTube', 'Shopify',
    'BuiltWith', 'Trustpilot', 'Tripadvisor', 'Yelp', 'Reddit', 'Airbnb',
    'eBay', 'Zillow', 'Upwork', 'Apollo', 'ZoomInfo',
  ];
  for (const src of sourcePatterns) {
    if (lowerDesc.includes(src.toLowerCase())) dataSources.push(src);
  }

  // Generate use cases
  const useCases = generateUseCases(name, cleanDesc, category, levers);

  // Build tags
  const tags = [category, ...levers, ...dataSources.slice(0, 3)];

  return {
    name,
    category,
    description: cleanDesc,
    url,
    affiliate_url: affiliateUrl,
    tags: [...new Set(tags)],
    industries: [...new Set(industries)],
    revenue_levers: [...new Set(levers)],
    data_sources: [...new Set(dataSources)],
    impact_level: impactLevel,
    use_cases: useCases,
  };
}

function generateUseCases(
  name: string,
  description: string,
  category: ApiCategory,
  levers: RevenueLever[],
): string[] {
  const useCases: string[] = [];
  const lower = (name + ' ' + description).toLowerCase();

  if (lower.includes('google maps') || lower.includes('local business')) {
    useCases.push('Local lead generation and competitor mapping');
    useCases.push('Identify low-rated competitors for outreach campaigns');
  }
  if (lower.includes('linkedin')) {
    useCases.push('B2B account research and ICP segmentation');
    useCases.push('Tech-stack based outbound targeting');
  }
  if (lower.includes('amazon') || lower.includes('price')) {
    useCases.push('Competitor price monitoring and margin protection');
    useCases.push('Daily price-delta alerts on high-margin products');
  }
  if (lower.includes('review') || lower.includes('sentiment')) {
    useCases.push('Review pain-point analysis for operational improvements');
    useCases.push('Sentiment gap identification vs competitors');
  }
  if (lower.includes('seo') || lower.includes('keyword') || lower.includes('search')) {
    useCases.push('Demand capture and SERP opportunity identification');
    useCases.push('Content gap analysis for high-intent keywords');
  }
  if (lower.includes('email') || lower.includes('validate')) {
    useCases.push('Outbound list hygiene and deliverability improvement');
  }
  if (lower.includes('facebook') || lower.includes('ad')) {
    useCases.push('Competitor ad creative monitoring and intelligence');
    useCases.push('UGC ad angle discovery and testing');
  }
  if (lower.includes('builtwith') || lower.includes('tech stack')) {
    useCases.push('ICP qualification by technology stack');
    useCases.push('Exclude non-ICP domains to reduce SDR waste');
  }

  // Fallback generic use cases by category
  if (useCases.length === 0) {
    if (category === 'Lead Generation') useCases.push('Automated lead discovery and qualification');
    else if (category === 'Ecommerce') useCases.push('Product and pricing intelligence for ecommerce');
    else if (category === 'SEO Tools') useCases.push('SEO monitoring and keyword opportunity discovery');
    else if (category === 'Social Media') useCases.push('Social listening and competitive intelligence');
    else useCases.push('Business intelligence and data automation');
  }

  return useCases.slice(0, 4);
}

// ─── README parser ────────────────────────────────────────────────────────────

async function parseReadme(category: ApiCategory, folder: string): Promise<ApiEntry[]> {
  const entries: ApiEntry[] = [];

  try {
    const file = Bun.file(`${folder}/README.md`);
    const exists = await file.exists();
    if (!exists) {
      console.warn(`[scanner] README not found: ${folder}/README.md`);
      return entries;
    }

    const content = await file.text();
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.startsWith('|') || line.includes('API Name') || line.includes('---')) continue;
      const parsed = parseTableRow(line, category);
      if (!parsed || !parsed.name || !parsed.url) continue;

      entries.push({
        id: crypto.randomUUID(),
        name: parsed.name!,
        category,
        description: parsed.description || '',
        url: parsed.url!,
        affiliate_url: parsed.affiliate_url!,
        tags: parsed.tags || [],
        industries: parsed.industries || ['Other'],
        revenue_levers: parsed.revenue_levers || ['Revenue Growth'],
        data_sources: parsed.data_sources || [],
        impact_level: parsed.impact_level || 'Medium',
        use_cases: parsed.use_cases || [],
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error(`[scanner] Error parsing ${folder}:`, err);
  }

  return entries;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan all category README files and return the full API catalog.
 * Results are cached in memory for CACHE_TTL_MS.
 */
export async function scanAllApis(forceRefresh = false): Promise<ApiEntry[]> {
  const now = Date.now();
  if (!forceRefresh && _catalogCache && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _catalogCache;
  }

  console.log('[scanner] Scanning API catalog…');
  const allEntries: ApiEntry[] = [];

  for (const [category, folder] of Object.entries(CATEGORY_FOLDERS) as [ApiCategory, string][]) {
    const entries = await parseReadme(category, folder);
    allEntries.push(...entries);
    console.log(`[scanner]   ${category}: ${entries.length} APIs`);
  }

  _catalogCache = allEntries;
  _cacheTimestamp = now;
  console.log(`[scanner] Total APIs scanned: ${allEntries.length}`);
  return allEntries;
}

/**
 * Get a filtered subset of the API catalog.
 */
export async function getFilteredApis(params: {
  category?: ApiCategory;
  industry?: Industry;
  lever?: RevenueLever;
  impact?: ImpactLevel;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: ApiEntry[]; total: number }> {
  const all = await scanAllApis();
  const { category, industry, lever, impact, search, page = 1, limit = 50 } = params;

  let filtered = all;

  if (category) {
    filtered = filtered.filter(a => a.category === category);
  }
  if (industry) {
    filtered = filtered.filter(a => a.industries.includes(industry));
  }
  if (lever) {
    filtered = filtered.filter(a => a.revenue_levers.includes(lever));
  }
  if (impact) {
    filtered = filtered.filter(a => a.impact_level === impact);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      a =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q)),
    );
  }

  const total = filtered.length;
  const start = (page - 1) * limit;
  const data = filtered.slice(start, start + limit);

  return { data, total };
}

/**
 * Seed the api_catalog table from the scanned data.
 * Safe to run multiple times — uses INSERT … ON CONFLICT DO NOTHING.
 * Inserts row-by-row in batches to avoid parameter limits.
 */
export async function seedApiCatalog(): Promise<number> {
  const db = getDb();
  const apis = await scanAllApis(true);
  let inserted = 0;

  // Insert in batches of 50 rows using postgres VALUES list
  const CHUNK = 50;
  for (let i = 0; i < apis.length; i += CHUNK) {
    const chunk = apis.slice(i, i + CHUNK);
    try {
      // Build rows for bulk insert using postgres tagged template
      const rows = chunk.map(a => ({
        id:            a.id,
        name:          a.name,
        category:      a.category,
        description:   a.description,
        url:           a.url,
        affiliate_url: a.affiliate_url,
        tags:          a.tags,
        industries:    a.industries,
        revenue_levers: a.revenue_levers,
        data_sources:  a.data_sources,
        impact_level:  a.impact_level,
        use_cases:     a.use_cases,
        created_at:    a.created_at,
      }));

      const result = await db`
        INSERT INTO api_catalog
          (id, name, category, description, url, affiliate_url, tags, industries,
           revenue_levers, data_sources, impact_level, use_cases, created_at)
        SELECT * FROM json_to_recordset(${JSON.stringify(rows)}::json)
          AS t(id uuid, name text, category text, description text, url text,
               affiliate_url text, tags text[], industries text[],
               revenue_levers text[], data_sources text[], impact_level text,
               use_cases text[], created_at timestamptz)
        ON CONFLICT DO NOTHING
      `;
      inserted += result.count ?? chunk.length;
    } catch (err) {
      console.error('[scanner] Seed chunk error:', err);
      // Fall back to individual inserts for this chunk
      for (const api of chunk) {
        try {
          await db`
            INSERT INTO api_catalog
              (id, name, category, description, url, affiliate_url, tags, industries,
               revenue_levers, data_sources, impact_level, use_cases, created_at)
            VALUES (
              ${api.id}, ${api.name}, ${api.category}, ${api.description},
              ${api.url}, ${api.affiliate_url},
              ${db.array(api.tags)}, ${db.array(api.industries)},
              ${db.array(api.revenue_levers)}, ${db.array(api.data_sources)},
              ${api.impact_level}, ${db.array(api.use_cases)}, ${api.created_at}
            )
            ON CONFLICT DO NOTHING
          `;
          inserted++;
        } catch {
          // Skip individual failures silently
        }
      }
    }
  }

  console.log(`[scanner] Seeded ${inserted} APIs into api_catalog`);
  return inserted;
}

/**
 * Get catalog statistics.
 */
export async function getCatalogStats(): Promise<{
  total: number;
  by_category: Record<string, number>;
  by_impact: Record<string, number>;
}> {
  const all = await scanAllApis();
  const by_category: Record<string, number> = {};
  const by_impact: Record<string, number> = { High: 0, Medium: 0, Low: 0 };

  for (const api of all) {
    by_category[api.category] = (by_category[api.category] || 0) + 1;
    by_impact[api.impact_level] = (by_impact[api.impact_level] || 0) + 1;
  }

  return { total: all.length, by_category, by_impact };
}
