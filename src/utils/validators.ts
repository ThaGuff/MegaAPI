import { ValidationError } from '../middleware/error';
import type { Industry, Plan, ReportFrequency } from '../types';

// ─── Primitive validators ─────────────────────────────────────────────────────

export function validateEmail(email: unknown): string {
  if (typeof email !== 'string' || !email.trim()) {
    throw new ValidationError('Email is required');
  }
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new ValidationError('Invalid email address');
  }
  return trimmed;
}

export function validateString(value: unknown, field: string, maxLen = 255): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new ValidationError(`${field} must be ${maxLen} characters or fewer`);
  }
  return trimmed;
}

export function validateOptionalString(value: unknown, field: string, maxLen = 255): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return validateString(value, field, maxLen);
}

export function validateEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function validateOptionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  if (value === undefined || value === null) return defaultValue;
  return validateEnum(value, field, allowed);
}

export function validatePositiveNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (isNaN(n) || n < 0) {
    throw new ValidationError(`${field} must be a positive number`);
  }
  return n;
}

export function validateUuid(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError(`${field} must be a valid UUID`);
  }
  return value;
}

// ─── Domain validators ────────────────────────────────────────────────────────

const VALID_INDUSTRIES: Industry[] = [
  'Local Services', 'Ecommerce', 'SaaS', 'Real Estate',
  'Healthcare', 'Finance', 'Travel', 'Media', 'Education', 'Other',
];

const VALID_PLANS: Plan[] = ['starter', 'growth', 'premium'];

const VALID_FREQUENCIES: ReportFrequency[] = ['daily', 'weekly', 'monthly'];

export function validateIndustry(value: unknown): Industry {
  return validateEnum(value, 'industry', VALID_INDUSTRIES);
}

export function validatePlan(value: unknown, defaultValue: Plan = 'starter'): Plan {
  return validateOptionalEnum(value, 'plan', VALID_PLANS, defaultValue);
}

export function validateFrequency(value: unknown, defaultValue: ReportFrequency = 'monthly'): ReportFrequency {
  return validateOptionalEnum(value, 'frequency', VALID_FREQUENCIES, defaultValue);
}

// ─── Request body validators ──────────────────────────────────────────────────

export function validateRegisterRequest(body: unknown): {
  name: string;
  email: string;
  industry: Industry;
  website?: string;
  region?: string;
  plan: Plan;
} {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body is required');
  }
  const b = body as Record<string, unknown>;

  return {
    name:     validateString(b.name, 'name', 100),
    email:    validateEmail(b.email),
    industry: validateIndustry(b.industry),
    website:  validateOptionalString(b.website, 'website', 500),
    region:   validateOptionalString(b.region, 'region', 100),
    plan:     validatePlan(b.plan),
  };
}

export function validateGenerateReportRequest(body: unknown): {
  business_id: string;
  title?: string;
  send_email: boolean;
} {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body is required');
  }
  const b = body as Record<string, unknown>;

  return {
    business_id: validateUuid(b.business_id, 'business_id'),
    title:       validateOptionalString(b.title, 'title', 200),
    send_email:  b.send_email === true,
  };
}

export function validatePaginationParams(query: Record<string, string>): {
  page: number;
  limit: number;
} {
  const page  = Math.max(1, parseInt(query.page  || '1',  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10) || 50));
  return { page, limit };
}
