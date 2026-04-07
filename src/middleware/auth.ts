import type { Context, Next } from 'hono';
import { AuthError } from './error';
import { getDb } from '../db/client';
import type { Business } from '../types';

// ─── JWT helpers ──────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

function base64url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return atob(pad ? padded + '='.repeat(4 - pad) : padded);
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return base64url(String.fromCharCode(...new Uint8Array(sig)));
}

export async function signJwt(payload: Record<string, unknown>, expiresInSec = 86400): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = base64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSec }));
  const sig    = await hmacSign(`${header}.${body}`, JWT_SECRET);
  return `${header}.${body}.${sig}`;
}

export async function verifyJwt(token: string): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Invalid token format');

  const [header, body, sig] = parts;
  const expected = await hmacSign(`${header}.${body}`, JWT_SECRET);
  if (sig !== expected) throw new AuthError('Invalid token signature');

  const payload = JSON.parse(base64urlDecode(body)) as Record<string, unknown>;
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new AuthError('Token expired');
  }
  return payload;
}

// ─── API key authentication ───────────────────────────────────────────────────

export async function lookupApiKey(apiKey: string): Promise<Business | null> {
  const db = getDb();
  const [row] = await db`SELECT * FROM businesses WHERE api_key = ${apiKey} LIMIT 1`;
  return (row as Business) || null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Require a valid API key (X-API-Key header) or Bearer JWT.
 * Attaches the business to c.set('business', ...).
 */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    // 1. Try API key
    const apiKey = c.req.header('X-API-Key');
    if (apiKey) {
      const business = await lookupApiKey(apiKey);
      if (!business) throw new AuthError('Invalid API key');
      c.set('business', business);
      return next();
    }

    // 2. Try Bearer JWT
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const payload = await verifyJwt(token);
        if (payload.business_id) {
          const db = getDb();
          const [row] = await db`SELECT * FROM businesses WHERE id = ${payload.business_id as string}`;
          if (row) {
            c.set('business', row as Business);
            return next();
          }
        }
      } catch {
        throw new AuthError('Invalid or expired token');
      }
    }

    throw new AuthError('Authentication required');
  };
}

/**
 * Optional auth — attaches business if credentials present, but doesn't block.
 */
export function optionalAuth() {
  return async (c: Context, next: Next) => {
    try {
      const apiKey = c.req.header('X-API-Key');
      if (apiKey) {
        const business = await lookupApiKey(apiKey);
        if (business) c.set('business', business);
      }
    } catch {
      // Ignore auth errors for optional auth
    }
    return next();
  };
}

/**
 * Admin-only middleware — checks ADMIN_SECRET header.
 */
export function requireAdmin() {
  return async (c: Context, next: Next) => {
    const secret = c.req.header('X-Admin-Secret');
    const expected = process.env.ADMIN_SECRET;
    if (!expected || secret !== expected) {
      throw new AuthError('Admin access required');
    }
    return next();
  };
}
