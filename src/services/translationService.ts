// ... existing code ...

import { LLMMessage, LLMOptions } from '../types';
import { LangDBAdapter } from './langdbAdapter';
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
    text?: string; // For frontend compatibility
    meaning?: string; // For backend compatibility
    pos: string;
    usage: string;
  }>;
  examples: Array<{
    es: string;
    en: string;
    context: string;
  }>;
  conjugations: Record<string, string[]>;
  audio: {
    ipa: string;
    suggestions: string[];
  };
  related: {
    synonyms: string[];
    antonyms: string[];
  };
}

export class TranslationService {
  private langdbAdapter: LangDBAdapter;
  private cache: Map<string, { data: TranslationResponse; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  private metrics = {
    requests: { count: 0, inc: () => this.metrics.requests.count++ },
    successes: { count: 0, inc: () => this.metrics.successes.count++ },
    errors: { count: 0, inc: () => this.metrics.errors.count++ }
  };

  constructor(langdbAdapter: LangDBAdapter) {
    this.langdbAdapter = langdbAdapter;
    // Log env vars to verify loading
    console.log('TranslationService initialized with LANGDB_GATEWAY_URL:', process.env.LANGDB_GATEWAY_URL || 'DEFAULT (generic)');
    console.log('LANGDB_MODEL:', process.env.LANGDB_MODEL || 'DEFAULT (gpt-4o-mini)');
  }

  private transformLangDBResponse(langdbResponse: any): TranslationResponse {
    // Transform definitions: meaning → text, pos → partOfSpeech
    const transformedDefinitions = langdbResponse.definitions?.map((def: any) => ({
      text: def.meaning || def.text || '', // Prefer meaning, fallback to text if exists
      partOfSpeech: def.pos || '',
      examples: def.examples || [], // Already matches
      synonyms: def.synonyms || [], // Already matches
    })) || [];

    // Transform examples: es → spanish, en → english
    const transformedExamples = langdbResponse.examples?.map((ex: any) => ({
      spanish: ex.es || ex.spanish || '',
      english: ex.en || ex.english || '',
    })) || [];

    // Transform conjugations: Keep as Record, but ensure it's Record<string, string> if needed
    const transformedConjugations = langdbResponse.conjugations || {};
    // If it's simple array for nouns, map to present singular/plural
    if (Array.isArray(transformedConjugations.present)) {
      transformedConjugations.present = {
        singular: transformedConjugations.present[0] || '',
        plural: transformedConjugations.present[1] || '',
      };
    }
    // For full verb conjugations, it's already Record, so no change

    // Transform audio: suggestions → AudioItem array
    const transformedAudio = (langdbResponse.audio?.suggestions || []).map((url: string) => ({
      url,
      type: 'pronunciation' as const,
      text: langdbResponse.audio?.ipa || '',
    })) || [];

    // Transform related: Flatten synonyms and antonyms to match frontend expectation
    const transformedRelated = {
      synonyms: langdbResponse.related?.synonyms || [],
      antonyms: langdbResponse.related?.antonyms || [],
    };

    return {
      definitions: transformedDefinitions,
      examples: transformedExamples,
      conjugations: transformedConjugations,
      audio: transformedAudio,
      related: transformedRelated,
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
      // Log before LangDB call
      console.log('📤 Calling LangDB for translation:', { text: request.text, sourceLang: request.sourceLang, targetLang: request.targetLang });

      // Call LangDB with timeout
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('LangDB timeout')), 300000)); // Increased to 300 seconds for gpt-5-mini processing
      const langdbResult = await Promise.race([
        this.langdbAdapter.translateStructured(
          request.text,
          request.sourceLang,
          request.targetLang,
          regionalContext
        ),
        timeoutPromise
      ]);

      console.log('✅ LangDB response received for:', request.text);

      // Transform the LangDB response to match frontend expectations
      const transformedResult = this.transformLangDBResponse(langdbResult);

      // Cache the transformed result
      this.cache.set(cacheKey, { data: transformedResult, timestamp: Date.now() });

      // Metrics: Increment success counter
      this.metrics.successes.inc();

      return transformedResult;
    } catch (langdbError: any) {
      console.error('❌ LangDB failed for', request.text, ':', langdbError.message);
      console.error('LangDB error details:', {
        error: langdbError.message,
        cause: langdbError.cause,
        stack: langdbError.stack,
        request: request
      });
      // Metrics: Increment error counter
      this.metrics.errors.inc();

      // Fallback to OpenRouter using general completion and parse
      try {
        console.log('🔄 LangDB failed, falling back to OpenRouter for', request.text);
        const openRouterAdapter = new OpenRouterAdapter(process.env.OPENROUTER_API_KEY || '', process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1');
        const systemPrompt = `You are a precise Spanish-English translator. Output ONLY JSON: {
"definitions": [{"meaning": "string", "pos": "noun|verb|adj|adv", "usage": "formal|informal|slang"}],
"examples": [{"es": "Spanish example", "en": "English example", "context": "usage context"}],
"conjugations": {"present": ["yo form", "tú form", ...], "past": [...]},
"audio": {"ipa": "phonetic", "suggestions": ["audio suggestions"]},
"related": {"synonyms": ["syn1"], "antonyms": ["ant1"]}
}. Use regional variants if context provided.`;

        const userPrompt = `Translate "${request.text}" from ${request.sourceLang} to ${request.targetLang}${regionalContext ? ` with ${regionalContext} context` : ''}.`;
        const messages: LLMMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ];
        const options: LLMOptions = {
          model: 'gpt-4o-mini', // Use compatible model
          timeout: 30000,
          requestId: `fallback_${Date.now()}`
        };
        const rawResult = await openRouterAdapter.fetchCompletion(messages, options);
        const fallbackResult = JSON.parse(rawResult);
        console.log('✅ OpenRouter fallback success for:', request.text);
        // Cache fallback result
        this.cache.set(cacheKey, { data: this.transformLangDBResponse(fallbackResult), timestamp: Date.now() });
        return this.transformLangDBResponse(fallbackResult);
      } catch (fallbackError: any) {
        console.error('❌ OpenRouter fallback also failed for', request.text, ':', fallbackError.message);
        // Final fallback JSON
        const finalFallback = {
          definitions: [
            {
              text: `Error: "${request.text}" (both services unavailable)`,
              meaning: `Error: "${request.text}" (both services unavailable)`,
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
  }

  async getTranslationHistory(userId: string): Promise<Array<{ query: string; response: TranslationResponse; timestamp: Date }>> {
    // TODO: Implement database storage for translation history
    // For now, return empty array
    return [];
  }

  async saveTranslation(userId: string, query: string, response: TranslationResponse): Promise<void> {
    // TODO: Implement database storage
    console.log(`Saving translation for user ${userId}: ${query}`);
  }

  private generateCacheKey(request: TranslationRequest): string {
    return `${request.text}_${request.sourceLang}_${request.targetLang}_${request.context || ''}`;
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

// Singleton instance
export const translationService = new TranslationService(new LangDBAdapter(
  process.env.LANGDB_API_KEY || '',
  process.env.LANGDB_GATEWAY_URL || 'https://api.us-east-1.langdb.ai/v1'
));

// Periodic cache cleanup
setInterval(() => {
  translationService.cleanupCache();
}, 1000 * 60 * 5); // Every 5 minutes