import express from 'express';
import { translationService, TranslationRequest } from '../services/translationService';
import { personaService } from '../services/personaService';

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 100; // requests per window

const router = express.Router();

// Rate limiting middleware
const rateLimit = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  // Clean up expired entries
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now > data.resetTime) {
      rateLimitStore.delete(ip);
    }
  }

  const clientData = rateLimitStore.get(clientIP);
  if (!clientData) {
    rateLimitStore.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + RATE_LIMIT_WINDOW;
    return next();
  }

  if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
    });
  }

  clientData.count++;
  next();
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
const logRequest = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
router.post('/', logRequest, rateLimit, async (req, res) => {
  try {
    // Enhanced validation
    const validation = validateTranslationRequest(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors,
        timestamp: new Date().toISOString()
      });
    }

    const { text, sourceLang, targetLang, context, userId }: TranslationRequest = req.body;

    const request: TranslationRequest = {
      text: text.trim(),
      sourceLang,
      targetLang,
      context,
      userId
    };

    console.log(`🔄 Processing translation request: ${text.substring(0, 50)}... (${sourceLang}→${targetLang})`);

    const result = await translationService.translate(request);

    // Save to history if userId provided
    if (userId) {
      await translationService.saveTranslation(userId, text.trim(), result);
    }

    // Add metadata to response
    const response = {
      ...result,
      metadata: {
        requestId: `translate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        sourceLang,
        targetLang,
        context: context || null,
        cached: false // TODO: Add cache hit detection
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Translation API error:', error);
    res.status(500).json({
      error: 'Translation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      requestId: `error_${Date.now()}`
    });
  }
});

// GET /api/translate/history/:userId - Get translation history
router.get('/history/:userId', logRequest, rateLimit, async (req, res) => {
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
      rateLimitRequests: RATE_LIMIT_MAX_REQUESTS,
      rateLimitWindowMinutes: RATE_LIMIT_WINDOW / (60 * 1000)
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
      max_requests: RATE_LIMIT_MAX_REQUESTS,
      window_minutes: RATE_LIMIT_WINDOW / (60 * 1000)
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
      active_clients: rateLimitStore.size,
      window_minutes: RATE_LIMIT_WINDOW / (60 * 1000)
    }
  });
});

export default router;