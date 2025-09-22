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
  // New: full dictionary entry for richer UI (SpanishDict-style)
  entry?: DictionaryEntry;
}

// New: SpanishDict-style dictionary entry schema
interface DictionaryEntry {
  headword: string;
  pronunciation: {
    ipa: string;
    syllabification?: string;
  };
  part_of_speech: string; // e.g., "n", "v", "adj"
  gender: 'm' | 'f' | 'mf' | null;
  inflections: string[];
  frequency?: number;
  senses: Array<{
    sense_number: number;
    registers?: string[]; // ["slang","colloquial","pejorative","vulgar","figurative","technical","archaic"]
    regions?: string[];   // ["Mexico","Caribbean","Venezuela","Guatemala","Latin America","Spain",...]
    gloss: string;
    usage_notes?: string;
    examples: Array<{ es: string; en: string }>;
    synonyms?: string[];
    antonyms?: string[];
    cross_references?: string[];
  }>;
}

export class TranslationService {
  private openRouterAdapter: OpenRouterAdapter;
  private cache: Map<string, { data: TranslationResponse; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  // New: version the schema/output format to safely bust stale cache entries
  private readonly SCHEMA_VERSION = 'dict_v1';
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
    // Accept either legacy structured JSON or the new DictionaryEntry JSON.
    // If it's a DictionaryEntry (has headword + senses), map it to legacy fields and return with entry.
    const isDictionaryEntry =
      openRouterResponse &&
      typeof openRouterResponse === 'object' &&
      Array.isArray(openRouterResponse.senses) &&
      typeof openRouterResponse.headword === 'string' &&
      openRouterResponse.pronunciation;

    if (isDictionaryEntry) {
      const entry = openRouterResponse as DictionaryEntry;

      // Ensure slang/colloquial/pejorative come first (defensive sort if model didn't order)
      const priority = (regs?: string[]) => {
        const set = new Set((regs || []).map((r) => r.toLowerCase()));
        if (set.has('slang') || set.has('colloquial') || set.has('pejorative') || set.has('vulgar')) return 0;
        // neutral/general next
        if (!set.has('technical') && !set.has('archaic')) return 1;
        // specialized last
        return 2;
      };
      const sortedSenses = [...entry.senses].sort((a, b) => {
        const pA = priority(a.registers);
        const pB = priority(b.registers);
        if (pA !== pB) return pA - pB;
        // broader region before narrow if tied
        const broad = (regions?: string[]) => (regions || []).some((r) => r.toLowerCase() === 'latin america') ? 0 : 1;
        const rA = broad(a.regions);
        const rB = broad(b.regions);
        if (rA !== rB) return rA - rB;
        // sense_number as final tie-breaker
        return (a.sense_number || 0) - (b.sense_number || 0);
      });

      const legacy = this.mapEntryToLegacy({ ...entry, senses: sortedSenses });

      return {
        definitions: legacy.definitions,
        examples: legacy.examples,
        conjugations: legacy.conjugations,
        audio: legacy.audio,
        related: legacy.related,
        entry: { ...entry, senses: sortedSenses }
      };
    }

    // Legacy structure passthrough (backward-compat)
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

      // Prefer translator persona prompt (SpanishDict-style JSON). Fall back to internal schema if persona not found.
      let translatorPersona: any = null;
      try {
        translatorPersona = await personaService.getPersona('translator');
      } catch {
        translatorPersona = null;
      }
      const systemPrompt =
        (translatorPersona && typeof translatorPersona.system_prompt === 'string' ? translatorPersona.system_prompt : undefined) ||
        `You are a precise Spanish-English translator. Output ONLY valid JSON matching this exact structure without any additional text or explanations:
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
  "conjugations": {},
  "audio": { "ipa": "", "suggestions": [] },
  "related": { "synonyms": [], "antonyms": [] }
}

Return ONLY JSON.`;

      // Ask for dictionary entry for the headword with slang-first ordering; include regional hint.
      const userPrompt = `Headword: ${request.text}
Source language: ${request.sourceLang}
Target language: ${request.targetLang}
Regional preference: ${regionalContext || 'general Spanish'}
Instructions:
- Produce a single JSON object per the schema in the system prompt.
- Ensure senses are ORDERED with slang/colloquial/pejorative/vulgar FIRST, then neutral/general, then technical/archaic/localized LAST.
- Include at least one bilingual (es/en) example per sense.
- Use compact labels for regions and registers.
- Output ONLY valid JSON, no extra text.`;

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      // Model precedence for translation:
      // 1) OPENROUTER_TRANSLATE_MODEL
      // 2) OPENROUTER_MODEL
      // 3) sensible free default
      const effectiveModel =
        process.env.OPENROUTER_TRANSLATE_MODEL ||
        process.env.OPENROUTER_MODEL ||
        'meta-llama/llama-3.3-8b-instruct:free';

      const options: LLMOptions = {
        model: effectiveModel,
        timeout: 30000,
        requestId: `translate_${Date.now()}`
      };

      const rawResult = await this.openRouterAdapter.fetchCompletion(messages, options);
      const parsedResult = JSON.parse(rawResult);
      const result = this.transformOpenRouterResponse(parsedResult);

      console.log('✅ Translation completed for:', request.text);

      // If the entry exists but has too few senses (e.g., only 1), force a retry prompting for full coverage.
      const entrySensesCount = (result as any)?.entry?.senses?.length ?? 0;
      // Retry when senses are missing or insufficient (< 3), to enumerate all common senses
      if (entrySensesCount < 3) {
        console.log(`🔁 Retry: insufficient sense coverage (${entrySensesCount}) for "${request.text}". Requesting expanded, multi-sense entry.`);
        const userPromptExpanded = `Headword: ${request.text}
Source language: ${request.sourceLang}
Target language: ${request.targetLang}
Regional preference: ${regionalContext || 'general Spanish'}
Instructions:
- Produce a single JSON object per the schema in the system prompt.
- ENUMERATE ALL COMMON SENSES as distinct items in "senses" (do NOT merge). Target 6–12 senses for polysemous nouns like "cuero".
- Keep ORDER: slang/colloquial/pejorative/vulgar FIRST; then neutral/general; then technical/archaic/localized LAST.
- Each sense MUST include at least one bilingual (es/en) example pair.
- Use compact labels for regions and registers.
- Output ONLY valid JSON, no extra text.`;

        const retryMessages: LLMMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPromptExpanded }
        ];
        const rawResult2 = await this.openRouterAdapter.fetchCompletion(retryMessages, options);
        const parsedResult2 = JSON.parse(rawResult2);
        const result2 = this.transformOpenRouterResponse(parsedResult2);
        const entrySensesCount2 = (result2 as any)?.entry?.senses?.length ?? 0;

        if (entrySensesCount2 >= entrySensesCount) {
          console.log(`✅ Retry improved coverage: ${entrySensesCount} → ${entrySensesCount2} senses for "${request.text}".`);
          // Cache the improved result and return
          this.cache.set(cacheKey, { data: result2, timestamp: Date.now() });
          this.metrics.successes.inc();
          return result2;
        } else {
          console.log(`⚠️ Retry did not improve coverage (still ${entrySensesCount2}). Proceeding with first result.`);
        }
      }

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
      } as TranslationResponse;
      console.log('🔄 TranslationService returning final fallback for', request.text);
      return finalFallback;
    }
  }

  // Map DictionaryEntry -> legacy fields for backward compatibility with existing UI
  private mapEntryToLegacy(entry: DictionaryEntry): TranslationResponse {
    const pos = entry.part_of_speech || undefined;

    const definitions = entry.senses.map((s) => {
      const usageLabels = (s.registers || []).join(', ');
      const examplesStrings = (s.examples || []).map((ex) => `${ex.es} — ${ex.en}`);
      return {
        text: s.gloss,
        meaning: s.gloss,
        partOfSpeech: pos,
        pos,
        usage: usageLabels || undefined,
        examples: examplesStrings.length > 0 ? examplesStrings : undefined
      };
    });

    const examples = entry.senses.flatMap((s) =>
      (s.examples || []).map((ex) => ({
        text: ex.es,
        translation: ex.en,
        spanish: ex.es,
        english: ex.en,
        context: s.usage_notes || (s.regions && s.regions.join(', ')) || undefined
      }))
    );

    const audio = {
      ipa: entry.pronunciation?.ipa || '',
      suggestions: entry.pronunciation?.syllabification ? [entry.pronunciation.syllabification] : []
    };

    // Aggregate synonyms/antonyms across senses (unique)
    const synSet = new Set<string>();
    const antSet = new Set<string>();
    entry.senses.forEach((s) => {
      (s.synonyms || []).forEach((w) => synSet.add(w));
      (s.antonyms || []).forEach((w) => antSet.add(w));
    });

    const related = {
      synonyms: Array.from(synSet),
      antonyms: Array.from(antSet)
    };

    return {
      definitions,
      examples,
      conjugations: {}, // not applicable for nouns; verb entries can fill later
      audio,
      related
    };
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
    return `${request.text}_${request.sourceLang}_${request.targetLang}_${request.context || ''}_${this.SCHEMA_VERSION}`;
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