import type { Request, Response, NextFunction } from 'express';
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';

// Resolve Stack/Neon Auth project ID from env (Vercel provides NEXT_PUBLIC_*, server can also use STACK_PROJECT_ID)
const STACK_PROJECT_ID =
  process.env.NEXT_PUBLIC_STACK_PROJECT_ID ||
  process.env.STACK_PROJECT_ID ||
  '';

// Issuer and JWKS URL per Neon Auth docs
const EXPECTED_ISSUER = STACK_PROJECT_ID
  ? `https://api.stack-auth.com/api/v1/projects/${STACK_PROJECT_ID}`
  : undefined;

const JWKS = STACK_PROJECT_ID
  ? createRemoteJWKSet(
      new URL(
        `https://api.stack-auth.com/api/v1/projects/${STACK_PROJECT_ID}/.well-known/jwks.json`
      )
    )
  : undefined;

// Optional audience validation if your tokens include an aud claim you want to enforce
const EXPECTED_AUDIENCE = process.env.STACK_EXPECTED_AUD;

/**
 * Neon/Stack Auth JWT verification middleware.
 * - Verifies Authorization: Bearer <token> using JOSE + remote JWKS.
 * - Attaches req.user = { id, sub, email, name, ...claims } on success.
 * - Returns 401 on missing/invalid/expired token.
 */
export async function neonAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (!JWKS || !EXPECTED_ISSUER) {
      console.warn(
        '[neonAuthMiddleware] STACK_PROJECT_ID not configured; reject protected request.'
      );
      return res.status(401).json({ error: 'Auth not configured' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    console.log('[neonAuthMiddleware] Auth header present:', !!authHeader, 'Token length:', token.length);
    console.log('[neonAuthMiddleware] Token preview (first 20 chars):', token.substring(0, 20) + '...');
    
    // Additional debugging for token format
    console.log('[neonAuthMiddleware] Token starts with "eyJ":', token.startsWith('eyJ'));
    console.log('[neonAuthMiddleware] Token contains dots (JWT format):', token.split('.').length === 3);
    console.log('[neonAuthMiddleware] Token format analysis:', {
      hasDots: token.includes('.'),
      dotCount: token.split('.').length,
      startsWithBearer: authHeader.startsWith('Bearer '),
      totalLength: token.length
    });

    if (!token) {
      console.log('[neonAuthMiddleware] No token found in Authorization header');
      return res.status(401).json({ error: 'Missing token' });
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: EXPECTED_ISSUER,
      audience: EXPECTED_AUDIENCE, // undefined is ignored
      // clockTolerance: 30, // optionally allow small clock skew (seconds)
    });

    // Attach stable identity from OIDC claims
    const sub = String(payload.sub || '');
    if (!sub) {
      return res.status(401).json({ error: 'Invalid token (no sub)' });
    }

    // Back-compat: many routes expect req.user.id; also expose sub/email/name
    (req as any).user = {
      id: sub,
      sub,
      email: (payload as JWTPayload & { email?: string }).email,
      name: (payload as JWTPayload & { name?: string }).name,
      // include entire payload for advanced use (non-sensitive)
      claims: payload,
    };

    return next();
  } catch (e: any) {
    // Token invalid/expired or signature mismatch
    return res.status(401).json({
      error: 'Invalid or expired token',
      details: process.env.NODE_ENV === 'development' ? e?.message : undefined,
    });
  }
}