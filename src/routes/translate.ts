import express from 'express';
import { translationService, TranslationRequest } from '../services/translationService';
import { personaService } from '../services/personaService';

const router = express.Router();

// POST /api/translate - Translate text with structured response
router.post('/', async (req, res) => {
  try {
    const { text, sourceLang, targetLang, context, userId }: TranslationRequest = req.body;

    // Validate required fields
    if (!text || !sourceLang || !targetLang) {
      return res.status(400).json({
        error: 'Missing required fields: text, sourceLang, targetLang'
      });
    }

    // Validate supported languages
    if (!['es', 'en'].includes(sourceLang) || !['es', 'en'].includes(targetLang)) {
      return res.status(400).json({
        error: 'Unsupported language pair. Supported: es, en'
      });
    }

    // Validate context if provided
    if (context && !personaService.isValidCountryKey(context)) {
      return res.status(400).json({
        error: `Invalid context: ${context}. Must be a valid country key.`
      });
    }

    const request: TranslationRequest = {
      text,
      sourceLang,
      targetLang,
      context,
      userId
    };

    const result = await translationService.translate(request);

    // Save to history if userId provided
    if (userId) {
      await translationService.saveTranslation(userId, text, result);
    }

    res.json(result);
  } catch (error) {
    console.error('Translation API error:', error);
    res.status(500).json({
      error: 'Translation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/translate/history/:userId - Get translation history
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        error: 'User ID is required'
      });
    }

    const history = await translationService.getTranslationHistory(userId);
    res.json(history);
  } catch (error) {
    console.error('Translation history API error:', error);
    res.status(500).json({
      error: 'Failed to retrieve translation history',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/translate/supported-languages - Get supported languages
router.get('/supported-languages', (req, res) => {
  res.json({
    languages: [
      { code: 'es', name: 'Spanish' },
      { code: 'en', name: 'English' }
    ],
    contexts: personaService.getAllPersonas().map(p => ({
      key: p.country_key,
      name: p.displayName,
      locale: p.locale_hint
    }))
  });
});

// GET /api/translate/health - Health check for translation service
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'translation',
    timestamp: new Date().toISOString(),
    supported_languages: ['es', 'en'],
    available_contexts: personaService.getAllPersonas().length
  });
});

export default router;