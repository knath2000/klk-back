// ... existing code ...

import { LangDBAdapter } from './langdbAdapter';
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
    meaning: string;
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

    try {
      // Log before LangDB call
      console.log('📤 Calling LangDB for translation:', { text: request.text, sourceLang: request.sourceLang, targetLang: request.targetLang });

      // Get regional context if provided
      let regionalContext = '';
      if (request.context) {
        const persona = await personaService.getPersona(request.context);
        if (persona) {
          regionalContext = persona.locale_hint || request.context;
        }
      }

      // Call LangDB with timeout
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('LangDB timeout')), 30000));
      const result = await Promise.race([
        this.langdbAdapter.translateStructured(
          request.text,
          request.sourceLang,
          request.targetLang,
          regionalContext
        ),
        timeoutPromise
      ]);

      console.log('✅ LangDB response received for:', request.text);

      // Cache the result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      // Metrics: Increment success counter
      this.metrics.successes.inc();

      return result;
    } catch (error: any) {
      console.error('❌ Translation service error for', request.text, ':', error.message);
      // Log full error for debugging
      console.error('Error details:', {
        error: error.message,
        stack: error.stack,
        request: request
      });
      // Metrics: Increment error counter
      this.metrics.errors.inc();
      throw new Error('Translation failed. Please try again.');
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
  process.env.LANGDB_BASE_URL || 'https://api.langdb.ai'
));

// Periodic cache cleanup
setInterval(() => {
  translationService.cleanupCache();
}, 1000 * 60 * 5); // Every 5 minutes