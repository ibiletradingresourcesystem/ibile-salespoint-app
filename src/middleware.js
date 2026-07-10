/**
 * Next.js Middleware — API Auth & Rate Limiting
 * 
 * Protects API routes with session cookie validation.
 * Only explicitly allowlisted GET endpoints remain public for login/offline bootstrap.
 * Rate limits the login endpoint to prevent PIN brute-force.
 * 
 * Uses Web Crypto API (Edge-compatible) for HMAC verification.
 */

import { NextResponse } from 'next/server';

const SESSION_COOKIE = 'pos-session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// --- Rate Limiting (in-memory, resets on server restart) ---
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_LOGIN = 10;     // 10 attempts per minute per IP

// Public POST paths that don't require session auth
const PUBLIC_POST_PATHS = [
  '/api/staff/login',
  '/api/staff/logout',
];

const PUBLIC_GET_PATHS = [
  '/api/staff/list',
  '/api/store/init-locations',
  '/api/categories',
  '/api/products',
  '/api/location/tenders',
  '/api/till/active',
];

function isPublicGetPath(pathname) {
  return PUBLIC_GET_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function getClientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.ip ||
    'unknown'
  );
}

function checkRateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  entry.count++;
  if (entry.count > maxAttempts) {
    const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  return { allowed: true, remaining: maxAttempts - entry.count };
}

// Periodically clean up stale rate-limit entries
let _cleanupScheduled = false;
function scheduleCleanup() {
  if (_cleanupScheduled) return;
  _cleanupScheduled = true;
  if (typeof globalThis.setInterval === 'function') {
    globalThis.setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW * 3) {
          rateLimitMap.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }
}

// --- HMAC verification (Web Crypto API for Edge compatibility) ---

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

async function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [staffId, timestamp, signature] = parts;
    const loginTime = parseInt(timestamp, 10);

    if (isNaN(loginTime) || Date.now() - loginTime > SESSION_MAX_AGE) return null;

    // Validate staffId looks like a MongoDB ObjectId (24 hex chars)
    if (!/^[a-f\d]{24}$/i.test(staffId)) return null;

    const secret = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') return null;
      console.warn('SESSION_SECRET/NEXTAUTH_SECRET is not set. Using development-only session secret.');
    }
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret || 'development-pos-session-secret'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const data = encoder.encode(`${staffId}.${timestamp}`);
    const sig = hexToBytes(signature);

    const valid = await crypto.subtle.verify('HMAC', key, sig, data);
    return valid ? { staffId, loginTime } : null;
  } catch {
    return null;
  }
}

// --- Middleware Handler ---

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only intercept API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  scheduleCleanup();

  // Rate-limit the login endpoint
  if (pathname === '/api/staff/login' && request.method === 'POST') {
    const ip = getClientIp(request);
    const { allowed, retryAfter } = checkRateLimit(
      `login:${ip}`,
      RATE_LIMIT_MAX_LOGIN,
      RATE_LIMIT_WINDOW
    );

    if (!allowed) {
      return NextResponse.json(
        {
          success: false,
          code: 'RATE_LIMITED',
          message: `Too many login attempts. Try again in ${retryAfter}s.`,
        },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }
  }

  // Public GETs are limited to login/offline bootstrap data only.
  if (request.method === 'GET' && isPublicGetPath(pathname)) {
    return NextResponse.next();
  }

  // Allow explicitly public POST paths
  if (PUBLIC_POST_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // --- All other POST/PUT/DELETE requests require auth ---
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { success: false, code: 'AUTH_REQUIRED', message: 'Authentication required' },
      { status: 401 }
    );
  }

  const session = await verifyToken(sessionToken);

  if (!session) {
    const response = NextResponse.json(
      { success: false, code: 'SESSION_EXPIRED', message: 'Session expired. Please log in again.' },
      { status: 401 }
    );
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  // Forward authenticated staff ID to downstream API handlers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-auth-staff-id', session.staffId);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: '/api/:path*',
};
