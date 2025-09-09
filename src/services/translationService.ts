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

  constructor(langdbAdapter: LangDBAdapter) {
    this.langdbAdapter = langdbAdapter;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const cacheKey = this.generateCacheKey(request);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log(`Translation cache hit for: ${request.text}`);
      return cached.data;
    }

    try {
      // Get regional context if provided
      let regionalContext = '';
      if (request.context) {
        const persona = await personaService.getPersona(request.context);
        if (persona) {
          regionalContext = persona.locale_hint || request.context;
        }
      }

      // Call LangDB translator
      const result = await this.langdbAdapter.translateStructured(
        request.text,
        request.sourceLang,
        request.targetLang,
        regionalContext
      );

      // Cache the result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;
    } catch (error) {
      console.error('Translation service error:', error);
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