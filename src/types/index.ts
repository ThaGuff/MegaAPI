// ─── Core Domain Types ────────────────────────────────────────────────────────

export interface Business {
  id: string;
  name: string;
  email: string;
  industry: Industry;
  website?: string;
  region?: string;
  api_key: string;
  plan: Plan;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  business_id: string;
  plan: Plan;
  status: SubscriptionStatus;
  frequency: ReportFrequency;
  next_report_date: string;
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  business_id: string;
  title: string;
  generated_at: string;
  sent_at?: string;
  data: ReportData;
  html_content?: string;
  status: ReportStatus;
}

export interface ApiEntry {
  id: string;
  name: string;
  category: ApiCategory;
  description: string;
  url: string;
  affiliate_url: string;
  tags: string[];
  industries: Industry[];
  revenue_levers: RevenueLever[];
  data_sources: string[];
  impact_level: ImpactLevel;
  use_cases: string[];
  created_at: string;
}

export interface BusinessSolution {
  id: string;
  business_id: string;
  api_id: string;
  api?: ApiEntry;
  use_case: string;
  impact_estimate: number;
  savings_estimate: number;
  score: number;
  status: SolutionStatus;
  notes?: string;
  created_at: string;
}

export interface ScheduledJob {
  id: string;
  business_id: string;
  job_type: JobType;
  schedule: string;
  last_run?: string;
  next_run: string;
  status: JobStatus;
  error_message?: string;
  created_at: string;
}

// ─── Enums / Union Types ──────────────────────────────────────────────────────

export type Industry =
  | 'Local Services'
  | 'Ecommerce'
  | 'SaaS'
  | 'Real Estate'
  | 'Healthcare'
  | 'Finance'
  | 'Travel'
  | 'Media'
  | 'Education'
  | 'Other';

export type Plan = 'starter' | 'growth' | 'premium';

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

export type ReportFrequency = 'daily' | 'weekly' | 'monthly';

export type ReportStatus = 'pending' | 'generating' | 'ready' | 'sent' | 'failed';

export type SolutionStatus = 'recommended' | 'in_progress' | 'implemented' | 'dismissed';

export type JobType = 'report_generation' | 'email_send' | 'data_refresh';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type RevenueLever = 'Revenue Growth' | 'Cost Savings' | 'Revenue Protection';

export type ImpactLevel = 'High' | 'Medium' | 'Low';

export type ApiCategory =
  | 'Lead Generation'
  | 'Ecommerce'
  | 'SEO Tools'
  | 'Social Media'
  | 'Automation'
  | 'AI'
  | 'Developer Tools'
  | 'Business'
  | 'Jobs'
  | 'News'
  | 'Real Estate'
  | 'Travel'
  | 'Videos'
  | 'Open Source'
  | 'Integrations'
  | 'MCP Servers'
  | 'Agents'
  | 'Other';

// ─── Report Data Structure ────────────────────────────────────────────────────

export interface ReportData {
  meta: ReportMeta;
  opportunities: Opportunity[];
  leads: Lead[];
  pricing: PricingSignal[];
  reviews: ReviewInsight[];
  seo: SeoSignal[];
  creative: CreativeIntel[];
  recommendations: string[];
  kpis: ReportKpis;
}

export interface ReportMeta {
  title: string;
  business_name: string;
  industry: string;
  generated_at: string;
  period: string;
}

export interface ReportKpis {
  total_opportunities: number;
  estimated_pipeline: number;
  potential_savings: number;
  avg_opportunity_score: number;
  top_lever: string;
}

export interface Opportunity {
  id: number;
  title: string;
  detail: string;
  source: string;
  lever: RevenueLever;
  impact: number;
  savings: number;
  score: number;
  priority: ImpactLevel;
  eta_days: number;
  owner: string;
  status: string;
}

export interface Lead {
  market: string;
  lead_pool: number;
  valid_contacts_pct: number;
  gap: string;
  fit_score: number;
  source: string;
}

export interface PricingSignal {
  label: string;
  pct: number;
  source: string;
  lever: RevenueLever;
}

export interface ReviewInsight {
  theme: string;
  mentions: number;
  severity: ImpactLevel;
  action: string;
  source: string;
}

export interface SeoSignal {
  cluster: string;
  intent: string;
  difficulty: string;
  priority: string;
  source: string;
}

export interface CreativeIntel {
  competitor: string;
  pattern: string;
  signal: string;
  test: string;
  source: string;
}

// ─── API Request/Response Types ───────────────────────────────────────────────

export interface RegisterBusinessRequest {
  name: string;
  email: string;
  industry: Industry;
  website?: string;
  region?: string;
  plan?: Plan;
}

export interface RegisterBusinessResponse {
  success: boolean;
  business: Business;
  api_key: string;
  message: string;
}

export interface ApiFilterParams {
  category?: ApiCategory;
  industry?: Industry;
  lever?: RevenueLever;
  impact?: ImpactLevel;
  search?: string;
  page?: number;
  limit?: number;
}

export interface SolutionRequest {
  business_id: string;
  industry: Industry;
  goals: string[];
  budget?: number;
}

export interface GenerateReportRequest {
  business_id: string;
  title?: string;
  send_email?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ─── Email Types ──────────────────────────────────────────────────────────────

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: string;
  content_type: string;
}

// ─── Scheduler Types ──────────────────────────────────────────────────────────

export interface JobDefinition {
  id: string;
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  enabled: boolean;
}

// ─── Scoring Types ────────────────────────────────────────────────────────────

export interface ScoringWeights {
  fit: number;
  urgency: number;
  market_gap: number;
  commercial_value: number;
  ease_of_execution: number;
}

export interface ScoredSolution {
  api: ApiEntry;
  use_case: string;
  impact_estimate: number;
  savings_estimate: number;
  score: number;
  reasoning: string;
}
