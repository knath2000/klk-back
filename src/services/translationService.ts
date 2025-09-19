import { LLMMessage, LLMOptions } from '../types';
import { OpenRouterAdapter } from './openrouterAdapter';
import { personaService } from './personaService';

export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  context?: string;
  userId?: string;
}

export interface TranslationResponse {
  definitions: Array<{
    text?: string;
    meaning?: string;
    partOfSpeech?: string;
    pos?: string;
    examples?: string[];
    usage?: string;
  }>;
  examples: Array<{
    text?: string;
    translation?: string;
    spanish?: string;
    english?: string;
    context?: string;
  }>;
  conjugations: Record<string, unknown>;
  audio: Array<{
    url?: string;
    pronunciation?: string;
    text?: string;
    type?: string;
  }> | {
    ipa?: string;
    suggestions?: string[];
  };
  related: {
    synonyms?: string[];
    antonyms?: string[];
  };
}

export class TranslationService {
  private openRouterAdapter: OpenRouterAdapter;
  private cache: Map<string, { data: TranslationResponse; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  private metrics = {
    requests: { count: 0, inc: () => this.metrics.requests.count++ },
    successes: { count: 0, inc: () => this.metrics.successes.count++ },
    errors: { count: 0, inc: () => this.metrics.errors.count++ }
  };

  constructor(openRouterAdapter: OpenRouterAdapter) {
    this.openRouterAdapter = openRouterAdapter;
    // Log env vars to verify loading
    console.log('TranslationService initialized with OPENROUTER_BASE_URL:', process.env.OPENROUTER_BASE_URL || 'DEFAULT (openrouter.ai)');
    console.log('OPENROUTER_MODEL:', process.env.OPENROUTER_MODEL || 'DEFAULT (gpt-4o-mini)');
  }

  private transformOpenRouterResponse(openRouterResponse: any): TranslationResponse {
    // OpenRouter returns structured JSON directly, light transformation for compatibility
    return {
      definitions: openRouterResponse.definitions || [],
      examples: openRouterResponse.examples || [],
      conjugations: openRouterResponse.conjugations || {},
      audio: openRouterResponse.audio || { ipa: '', suggestions: [] },
      related: openRouterResponse.related || { synonyms: [], antonyms: [] }
    };
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const cacheKey = this.generateCacheKey(request);
    console.log('🔄 Processing translation for:', request.text, 'cacheKey:', cacheKey);

    // Metrics: Increment request counter
    this.metrics.requests.inc();

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log(`Translation cache hit for: ${request.text}`);
      return cached.data;
    }

    // Get regional context if provided (declare outside try-catch)
    let regionalContext = '';
    if (request.context) {
      const persona = await personaService.getPersona(request.context);
      if (persona) {
        regionalContext = persona.locale_hint || request.context;
      }
    }

    try {
      // Log before OpenRouter call
      console.log('📤 Calling OpenRouter for translation:', { text: request.text, sourceLang: request.sourceLang, targetLang: request.targetLang });

      const systemPrompt = `You are a precise Spanish-English translator. Output ONLY valid JSON matching this exact structure without any additional text or explanations:

{
  "definitions": [
    {
      "meaning": "primary meaning in target language",
      "pos": "noun|verb|adjective|adverb",
      "usage": "formal|informal|slang|regional",
      "examples": ["example sentence 1", "example sentence 2"]
    }
  ],
  "examples": [
    {
      "es": "Spanish example sentence",
      "en": "English translation of example",
      "context": "usage context or notes"
    }
  ],
  "conjugations": {
    "present": ["yo form", "tú form", "él/ella/usted form", "nosotros form", "vosotros form", "ellos/ellas/ustedes form"],
    "preterite": ["preterite forms"],
    "future": ["future forms"]
  },
  "audio": {
    "ipa": "international phonetic alphabet transcription",
    "suggestions": ["pronunciation tips or audio notes"]
  },
  "related": {
    "synonyms": ["synonym1", "synonym2"],
    "antonyms": ["antonym1"]
  }
}

Incorporate regional context if provided: ${regionalContext || 'general Spanish'}. Ensure all fields are populated appropriately for the word "${request.text}" from ${request.sourceLang} to ${request.targetLang}.`;

      const userPrompt = `Provide detailed translation and linguistic breakdown for the word/phrase "${request.text}".`;

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const options: LLMOptions = {
        model: process.env.OPENROUTER_MODEL || 'gpt-4o-mini',
        timeout: 30000,
        requestId: `translate_${Date.now()}`
      };

      const rawResult = await this.openRouterAdapter.fetchCompletion(messages, options);
      const parsedResult = JSON.parse(rawResult);
      const result = this.transformOpenRouterResponse(parsedResult);

      console.log('✅ Translation completed for:', request.text);

      // Cache the result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      // Metrics: Increment success counter
      this.metrics.successes.inc();

      return result;
    } catch (error: any) {
      console.error('❌ OpenRouter failed for', request.text, ':', error.message);
      console.error('OpenRouter error details:', {
        error: error.message,
        cause: error.cause,
        stack: error.stack,
        request: request
      });
      // Metrics: Increment error counter
      this.metrics.errors.inc();

      // Final fallback JSON
      const finalFallback = {
        definitions: [
          {
            text: `Error: "${request.text}" (service unavailable)`,
            meaning: `Error: "${request.text}" (service unavailable)`,
            pos: 'unknown',
            usage: 'error'
          }
        ],
        examples: [],
        conjugations: {},
        audio: { ipa: '', suggestions: [] },
        related: { synonyms: [], antonyms: [] }
      };
      console.log('🔄 TranslationService returning final fallback for', request.text);
      return finalFallback;
    }
  }

  async getTranslationHistory(userId: string, limit: number = 50, offset: number = 0): Promise<Array<{ query: string; response: TranslationResponse; timestamp: Date }>> {
    // TODO: Implement database storage for translation history with pagination
    // For now, return empty array
    console.log(`Getting translation history for user ${userId} (limit: ${limit}, offset: ${offset})`);
    return [];
  }

  async saveTranslation(userId: string, query: string, response: TranslationResponse): Promise<void> {
    // TODO: Implement database storage
    console.log(`Saving translation for user ${userId}: ${query}`);
  }

  private generateCacheKey(request: TranslationRequest): string {
    return `${request.text}_${request.sourceLang}_${request.targetLang}_${request.context || ''}`;
  }

  // Get metrics for monitoring
  getMetrics() {
    return {
      requests: this.metrics.requests.count,
      successes: this.metrics.successes.count,
      errors: this.metrics.errors.count
    };
  }

  // Get cache statistics
  getCacheStats() {
    const now = Date.now();
    let totalEntries = 0;
    let expiredEntries = 0;

    for (const [key, value] of this.cache.entries()) {
      totalEntries++;
      if (now - value.timestamp > this.CACHE_TTL) {
        expiredEntries++;
      }
    }

    return {
      totalEntries,
      expiredEntries,
      activeEntries: totalEntries - expiredEntries,
      cacheSize: this.cache.size,
      ttlMinutes: this.CACHE_TTL / (1000 * 60)
    };
  }

  // Clear expired cache entries
  cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instance - now using OpenRouter exclusively
export const translationService = new TranslationService(
  new OpenRouterAdapter(
    process.env.OPENROUTER_API_KEY || '',
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  )
);

// Periodic cache cleanup
setInterval(() => {
  translationService.cleanupCache();
}, 1000 * 60 * 5); // Every 5 minutes