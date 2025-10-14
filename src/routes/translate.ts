import express, { Request, Response, NextFunction, Router } from 'express';
import { randomUUID } from 'crypto';
import { translationService, TranslationRequest } from '../services/translationService';
import { personaService } from '../services/personaService';
import rateLimit, { RateLimitRequestHandler, ipKeyGenerator } from 'express-rate-limit';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const GUEST_MAX_REQUESTS = 30;
const AUTH_MAX_REQUESTS = 120;
const MAX_BODY_BYTES = 8 * 1024; // 8KB payload limit for guests

const myIpKeyGenerator = (request: Request, response: Response): string => {
  // Using the original ipKeyGenerator from the library
  return (ipKeyGenerator as any)(request, response); // Cast to any to bypass persistent TypeScript error
};

const guestLimiter: RateLimitRequestHandler = rateLimit({ // Line 12
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: GUEST_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: myIpKeyGenerator, // Use the custom wrapper
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Guest rate limit exceeded. Please wait a bit before trying again.',
      retryAfter: res.getHeader('Retry-After') ?? Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    });
  },
});

const authedLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: AUTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => `${getRequestUserId(req) || 'guest'}:${myIpKeyGenerator(req, res)}`, // Combine user ID with custom wrapper output
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please wait a moment and try again.',
      retryAfter: res.getHeader('Retry-After') ?? Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    });
  },
});

type CachedResponse = {
  data: any;
  expiresAt: number;
};

const guestCache = new Map<string, CachedResponse>();
const GUEST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const router: Router = express.Router();

function getRequestUserId(req: Request): string | null {
  const user = (req as any).user;
  if (user && typeof user.id === 'string') {
    return user.id;
  }
  return null;
}

const selectLimiter = (req: Request, res: Response, next: NextFunction) => {
  const userId = getRequestUserId(req);
  const limiter = userId ? authedLimiter : guestLimiter;
  limiter(req, res, next);
};

const translateHandler = async (req: Request, res: Response) => {
  const requestUserId = getRequestUserId(req);
  const isGuest = !requestUserId;

  // Ensure anon_id cookie for guests so we can persist guest translations with a stable id
  let anonId: string | undefined = undefined;
  try {
    anonId = req.cookies?.anon_id;
  } catch {
    anonId = undefined;
  }

  if (!requestUserId && !anonId) {
    // Generate a stable anon id for the guest and set it as a secure, httpOnly cookie
    try {
      anonId = randomUUID();
      res.cookie('anon_id', anonId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 180 * 24 * 60 * 60 * 1000, // 180 days
      });
      console.log('🔑 Assigned anon_id cookie for guest:', anonId);
    } catch (err) {
      console.warn('Failed to set anon_id cookie for guest:', err);
      anonId = undefined;
    }
  }

  // Compute effectiveUserId early (used to attribute persistence/cache keys)
  const effectiveUserId = (typeof req.body?.userId === 'string' && req.body.userId.trim())
    ? String(req.body.userId).trim()
    : requestUserId || anonId || undefined;

  if (isGuest) {
    try {
      const bodySize = Buffer.byteLength(JSON.stringify(req.body || ''), 'utf8');
      if (bodySize > MAX_BODY_BYTES) {
        return res.status(413).json({
          error: 'Request too large',
          message: 'Guest translation payload exceeds 8KB limit.',
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Ignore stringify errors; validation will handle malformed payloads
    }
  }

  try {
    const validation = validateTranslationRequest(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors,
        timestamp: new Date().toISOString()
      });
    }

    // Defensive extraction + recovery: accept body fields or fallback to query params when necessary
    const body = req.body || {};
    let text: string | undefined = typeof body.text === 'string' ? body.text : undefined;
    let sourceLang: string | undefined = typeof body.sourceLang === 'string' ? body.sourceLang : undefined;
    let targetLang: string | undefined = typeof body.targetLang === 'string' ? body.targetLang : undefined;
    let context: string | undefined = typeof body.context === 'string' ? body.context : undefined;
    let userId: string | undefined = typeof body.userId === 'string' ? body.userId : undefined;

    // Recover from "undefined" string or missing fields by checking query params
    if (typeof text === 'string' && text.trim() === 'undefined') {
      const qText = typeof req.query?.text === 'string' ? String(req.query.text) : undefined;
      console.warn('🔧 Recovering translation "text" from query params (was string "undefined"):', qText ? qText.slice(0, 100) : null);
      text = qText;
    }
    if (!text && typeof req.query?.text === 'string') {
      text = String(req.query.text);
      console.log('🔧 Extracted translation text from query params:', text.slice(0, 100));
    }

    // Normalize language codes with safe defaults
    if (!sourceLang && typeof req.query?.sourceLang === 'string') sourceLang = String(req.query.sourceLang);
    if (!targetLang && typeof req.query?.targetLang === 'string') targetLang = String(req.query.targetLang);

    if (!sourceLang) sourceLang = 'en';
    if (!targetLang) targetLang = 'es';

    // Final typed request assembly (ensure text is a string to allow .trim())
    const request: TranslationRequest = {
      text: (text || '').trim(),
      sourceLang: sourceLang || 'en',
      targetLang: targetLang || 'es',
      context,
      userId: effectiveUserId,
    };

    // CRITICAL GUARD: After all recovery and defaults, if any core field is still "undefined" (string literal), reject.
    if (request.text === 'undefined' || request.sourceLang === 'undefined' || request.targetLang === 'undefined') {
      console.error('🚨 Backend: Rejecting translation request due to literal "undefined" string in core fields:', {
        text: request.text,
        sourceLang: request.sourceLang,
        targetLang: request.targetLang,
        rawBody: req.body, // For debugging original payload
        recoveredFromQuery: {
          text: req.query?.text,
          sourceLang: req.query?.sourceLang,
          targetLang: req.query?.targetLang,
        },
      });
      return res.status(400).json({
        error: 'Invalid translation request',
        message: 'One or more required fields contain the incorrect value "undefined".',
        timestamp: new Date().toISOString(),
        requestId: `error_undefined_${Date.now()}`
      });
    }

    // Diagnostic: log processing context after request assembled (safe to use request.text)
    console.log(`🔄 Processing translation request: ${request.text.substring(0, 50)}... (${request.sourceLang}→${request.targetLang})`, {
      guest: isGuest,
      userId: effectiveUserId ?? null,
    });

    // Check DB cache for existing translation (global, user-agnostic) before invoking LLM
    try {
      const cached = await translationService.findCachedTranslation(request.text, request.sourceLang, request.targetLang);
      if (cached) {
        console.log('🗃️ Cache hit for translation:', request.text, 'lang:', request.sourceLang, '->', request.targetLang);
        const responseBody = {
          ...cached,
          metadata: {
            requestId: `cache_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
            timestamp: new Date().toISOString(),
            sourceLang,
            targetLang,
            context: context || null,
            cached: true
          }
        };
        return res.json(responseBody);
      }
    } catch (cacheErr) {
      console.warn('Cache lookup failed (continuing to LLM):', cacheErr);
      // continue to LLM
    }

    const cacheKey = isGuest ? `${request.text}_${request.sourceLang}_${request.targetLang}_${request.context || ''}` : null;
    if (isGuest && cacheKey) {
      const cached = guestCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        console.log(`♻️ Guest translation cache hit for "${request.text}"`);
        return res.json({
          ...cached.data,
          metadata: {
            ...(cached.data.metadata || {}),
            cached: true,
            requestId: cached.data.metadata?.requestId || `translate_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          },
        });
      }
      if (cached && cached.expiresAt <= Date.now()) {
        guestCache.delete(cacheKey);
      }
    }

    const result = await translationService.translate(request);

    // Persist the translation for both authenticated users and guests (effectively keyed by anon_id)
    if (effectiveUserId) {
      try {
        // Use request.text which is normalized to a string
        await translationService.saveTranslation(effectiveUserId, request.text, result, request.sourceLang, request.targetLang);
      } catch (persistErr) {
        console.warn('Failed to persist translation (REST):', persistErr);
      }
    }

    const responseBody = {
      ...result,
      metadata: {
        requestId: `translate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        sourceLang,
        targetLang,
        context: context || null,
        cached: false
      }
    };

    if (isGuest && cacheKey) {
      guestCache.set(cacheKey, {
        data: responseBody,
        expiresAt: Date.now() + GUEST_CACHE_TTL_MS,
      });
    }

    return res.json(responseBody);
  } catch (error) {
    console.error('Translation API error:', error, { guest: isGuest, userId: requestUserId ?? null });
    return res.status(500).json({
      error: 'Translation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      requestId: `error_${Date.now()}`
    });
  }
};

// Enhanced input validation
const validateTranslationRequest = (body: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    errors.push('Request body must be a valid JSON object');
    return { isValid: false, errors };
  }

  const { text, sourceLang, targetLang, context, userId } = body;

  // Required fields validation
  if (!text || typeof text !== 'string') {
    errors.push('text is required and must be a string');
  } else if (text.trim().length === 0) {
    errors.push('text cannot be empty');
  } else if (text.length > 1000) {
    errors.push('text must be less than 1000 characters');
  }

  if (!sourceLang || typeof sourceLang !== 'string') {
    errors.push('sourceLang is required and must be a string');
  } else if (!['es', 'en'].includes(sourceLang)) {
    errors.push('sourceLang must be either "es" or "en"');
  }

  if (!targetLang || typeof targetLang !== 'string') {
    errors.push('targetLang is required and must be a string');
  } else if (!['es', 'en'].includes(targetLang)) {
    errors.push('targetLang must be either "es" or "en"');
  }

  // Prevent same language translation
  if (sourceLang === targetLang) {
    errors.push('sourceLang and targetLang cannot be the same');
  }

  // Optional fields validation
  if (context !== undefined) {
    if (typeof context !== 'string') {
      errors.push('context must be a string if provided');
    } else if (context.length > 10) {
      errors.push('context must be less than 10 characters');
    } else if (!personaService.isValidCountryKey(context)) {
      errors.push(`Invalid context: ${context}. Must be a valid country key.`);
    }
  }

  if (userId !== undefined && typeof userId !== 'string') {
    errors.push('userId must be a string if provided');
  }

  return { isValid: errors.length === 0, errors };
};

// Request logging middleware
const logRequest = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

  console.log(`📨 [${new Date().toISOString()}] Translation request from ${clientIP}:`, {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    body: req.body ? {
      text: req.body.text?.substring(0, 50) + (req.body.text?.length > 50 ? '...' : ''),
      sourceLang: req.body.sourceLang,
      targetLang: req.body.targetLang,
      context: req.body.context,
      hasUserId: !!req.body.userId
    } : null
  });

  // Log response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - startTime;
    console.log(`📤 [${new Date().toISOString()}] Translation response (${res.statusCode}) in ${duration}ms`);
    return originalSend.call(this, data);
  };

  next();
};

// POST /api/translate - Translate text with structured response
router.post('/', logRequest, selectLimiter, translateHandler);
router.post('/request', logRequest, selectLimiter, translateHandler);

// GET /api/translate/history/:userId - Get translation history
router.get('/history/:userId', logRequest, selectLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        error: 'Valid user ID is required',
        timestamp: new Date().toISOString()
      });
    }

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: 'Limit must be a number between 1 and 100',
        timestamp: new Date().toISOString()
      });
    }

    if (isNaN(offsetNum) || offsetNum < 0) {
      return res.status(400).json({
        error: 'Offset must be a non-negative number',
        timestamp: new Date().toISOString()
      });
    }

    const history = await translationService.getTranslationHistory(userId, limitNum, offsetNum);
    res.json({
      history,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        hasMore: history.length === limitNum
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Translation history API error:', error);
    res.status(500).json({
      error: 'Failed to retrieve translation history',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/translate/supported-languages - Get supported languages and contexts
router.get('/supported-languages', logRequest, (req, res) => {
  res.json({
    languages: [
      { code: 'es', name: 'Spanish', nativeName: 'Español' },
      { code: 'en', name: 'English', nativeName: 'English' }
    ],
    contexts: personaService.getAllPersonas().map(p => ({
      key: p.country_key,
      name: p.displayName,
      locale: p.locale_hint,
      description: `Spanish variant from ${p.displayName}`
    })),
    features: {
      streaming: true,
      caching: true,
      regionalVariants: true,
      history: true
    },
    limits: {
      maxTextLength: 1000,
      guestRateLimitRequests: GUEST_MAX_REQUESTS,
      authedRateLimitRequests: AUTH_MAX_REQUESTS,
      rateLimitWindowMinutes: RATE_LIMIT_WINDOW_MS / (60 * 1000)
    },
    timestamp: new Date().toISOString()
  });
});

// GET /api/translate/health - Enhanced health check
router.get('/health', logRequest, (req, res) => {
  const metrics = translationService.getMetrics();

  res.json({
    status: 'ok',
    service: 'translation',
    timestamp: new Date().toISOString(),
    version: '3.0.0', // Phase 3 implementation
    supported_languages: ['es', 'en'],
    available_contexts: personaService.getAllPersonas().length,
    metrics: {
      requests_total: metrics.requests,
      successes_total: metrics.successes,
      errors_total: metrics.errors,
      success_rate: metrics.requests > 0 ? (metrics.successes / metrics.requests * 100).toFixed(2) + '%' : '0%'
    },
    cache: {
      enabled: true,
      ttl_minutes: 30
    },
    rate_limiting: {
      enabled: true,
      guest_max_requests: GUEST_MAX_REQUESTS,
      authed_max_requests: AUTH_MAX_REQUESTS,
      window_minutes: RATE_LIMIT_WINDOW_MS / (60 * 1000)
    }
  });
});

// GET /api/translate/stats - Analytics endpoint (admin only)
router.get('/stats', logRequest, (req, res) => {
  // TODO: Add authentication check for admin access
  const metrics = translationService.getMetrics();
  const cacheStats = translationService.getCacheStats();

  res.json({
    timestamp: new Date().toISOString(),
    metrics,
    cache: cacheStats,
    rate_limiting: {
      window_minutes: RATE_LIMIT_WINDOW_MS / (60 * 1000),
      guest_max_requests: GUEST_MAX_REQUESTS,
      authed_max_requests: AUTH_MAX_REQUESTS
    }
  });
});

export default router;