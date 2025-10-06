import { LLMMessage, LLMOptions } from '../types';
import { OpenRouterAdapter } from './openrouterAdapter';
import { personaService } from './personaService';
import { TranslationResponseSchema } from './translationSchema';

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
    // New: explicit Spanish translation/lemma for this sense (for EN→ES visibility)
    translation_es?: string;
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

  /**
   * Heuristic to detect likely English headwords to trigger EN→ES directives.
   * - If user explicitly sets sourceLang 'en', treat as English.
   * - Otherwise, a lightweight heuristic: mostly ASCII letters, spaces, hyphens/apostrophes,
   *   no common Spanish diacritics. Not perfect, but sufficient to gate prompt rules.
   */
  private isProbablyEnglish(input: string | undefined, hintedSrc?: string): boolean {
    if ((hintedSrc || '').toLowerCase() === 'en') return true;
    const s = (input || '').trim();
    if (!s) return false;
    const hasSpanishDiacritics = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(s);
    if (hasSpanishDiacritics) return false;
    // Allow letters, digits, space, dash, apostrophe; penalize heavy punctuation or underscores
    const asciiLike = /^[A-Za-z0-9\s\-\’\'\.\/]+$/.test(s);
    return asciiLike;
  }

  constructor(openRouterAdapter: OpenRouterAdapter) {
    this.openRouterAdapter = openRouterAdapter;
    // Log env vars to verify loading
    console.log('TranslationService initialized with OPENROUTER_BASE_URL:', process.env.OPENROUTER_BASE_URL || 'DEFAULT (openrouter.ai)');
    console.log('OPENROUTER_MODEL:', process.env.OPENROUTER_MODEL || 'DEFAULT (gpt-4o-mini)');
    console.log('OPENROUTER_TRANSLATE_MODEL:', process.env.OPENROUTER_TRANSLATE_MODEL || 'DEFAULT (meta-llama/llama-4-maverick:free)');
  }

  private transformOpenRouterResponse(openRouterResponse: any): TranslationResponse {
    // Log raw response for debugging schema issues
    console.log('🔍 Raw OpenRouter response before validation:', JSON.stringify(openRouterResponse, null, 2));

    // Inject defaults for missing optional fields to prevent Zod validation errors
    const responseWithDefaults = {
      definitions: openRouterResponse.definitions || [],
      examples: openRouterResponse.examples || [],
      conjugations: openRouterResponse.conjugations || {},
      audio: openRouterResponse.audio || { ipa: '', suggestions: [] },
      related: openRouterResponse.related || { synonyms: [], antonyms: [] },
      entry: openRouterResponse.entry, // optional field
    };

    // Validate against schema first
    const validated = TranslationResponseSchema.parse(responseWithDefaults);
    
    // Accept either legacy structured JSON or the new DictionaryEntry JSON.
    // If it's a DictionaryEntry (has headword + senses), map it to legacy fields and return with entry.
    const isDictionaryEntry =
      validated.entry &&
      Array.isArray(validated.entry.senses) &&
      typeof validated.entry.headword === 'string' &&
      validated.entry.pronunciation;

    if (isDictionaryEntry) {
      const entry = validated.entry as DictionaryEntry;

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

    // If we have a dictionary entry but no definitions, synthesize them from senses
    if (isDictionaryEntry && (!validated.definitions || validated.definitions.length === 0)) {
      const entry = validated.entry as DictionaryEntry;
      console.log('🔄 Synthesizing definitions from entry senses for:', entry.headword);
      const synthesizedDefinitions = this.synthesizeDefinitionsFromEntry(entry);
      validated.definitions = synthesizedDefinitions;
      console.log(`✅ Synthesized ${synthesizedDefinitions.length} definitions from ${entry.senses.length} senses`);
    }


    // Legacy structure passthrough (backward-compat)
    return {
      definitions: validated.definitions || [],
      examples: validated.examples || [],
      conjugations: validated.conjugations || {},
      audio: validated.audio || { ipa: '', suggestions: [] },
      related: Array.isArray(validated.related)
        ? { synonyms: [], antonyms: [] } // Convert array format to object format
        : (validated.related || { synonyms: [], antonyms: [] })
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
      const { definitions = [], entry } = cached.data;
      if (!entry && definitions.length === 0) {
        console.warn(`🔄 Stale cache entry for "${request.text}" (no definitions/entry), purging`);
        this.cache.delete(cacheKey);
        this.metrics.errors.inc();
      } else {
        console.log(`✅ Translation cache hit for: "${request.text}" (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s, definitions: ${definitions.length}, hasEntry: ${!!entry})`);
        return cached.data;
      }
    } else if (cached) {
      console.log(`⏰ Cache expired for "${request.text}" (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s), fetching fresh`);
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

Return ONLY JSON. Do NOT include markdown code fences or any prose before/after the JSON object.`;

      const isEN = this.isProbablyEnglish(request.text, request.sourceLang);
      // Default languages when missing: for detected English inputs, default to EN→ES
      const effectiveSource = (request.sourceLang && request.sourceLang.trim()) || (isEN ? 'en' : (request.sourceLang || ''));
      const effectiveTarget = (request.targetLang && request.targetLang.trim()) || (isEN ? 'es' : (request.targetLang || 'es'));

      // EN→ES dictionary entry directives (from MCP research) appended only when English is detected
      const enToEsDirectives = isEN ? `
EN→ES Dictionary Directives (for English input):
- Target entry language: Spanish. Provide the headword (entrada) in Spanish (canonical or common colloquial form) and mark region/register per sense (e.g., México, España, Caribe; coloquial, vulgar, juvenil).
- Senses: If the English term has both literal and idiomatic meanings, create separate sub-senses: first the literal, then the most common idiomatic one(s). Prefer regional Spanish slang equivalents when the English input is slang (e.g., GOAT → el/la mejor; la mera mera [México]; la hostia [España], with labels).
- Examples: Provide one or two examples per sense, Spanish sentence followed by the English equivalent in parentheses. Keep metalanguage in Spanish; only the parenthetical line is English.
- Synonyms/Antonyms: Provide Spanish-only synonyms/antonyms when natural and regionally appropriate.
- Maintain Spanish-only metadata and labels; avoid English glosses as headwords. Do NOT use response_format/json_schema; output must remain plain text or JSON as instructed by the core prompt.
- IMPORTANT (visibility): For each sense, include "translation_es" (string) with the most natural Spanish word/phrase that translates the English headword in that specific sense (e.g., "línea del frente", "primera línea").
` : ``;

      // Find the keyword to start the prompt
      const findKeyword = /\bHeadword:\b<\/injectKeyword>.*/i.exec(enToEsDirectives);
      const userPrompt = `Headword: ${request.text}
Source language: ${effectiveSource}
Target language: ${effectiveTarget}
Regional preference: ${regionalContext || 'general Spanish'}
Instructions:
- Produce a single JSON object per the schema in the system prompt.
- Ensure senses are ORDERED with slang/colloquial/pejorative/vulgar FIRST, then neutral/general, then technical/archaic/localized LAST.
- Include at least one bilingual (es/en) example per sense.
- Use compact labels for regions and registers.
- Output ONLY valid JSON, no extra text.
- Do NOT use markdown code fences (no \`\`\`json blocks).

${findKeyword ? findKeyword[0].replace(/\bHeadword:\b<\/injectKeyword>/i, '') : ''}
Normalization (slang/SMS misspellings):
- If the typed headword appears to be a texting/phonetic variant, normalize to the canonical headword while preserving alias spellings in "cross_references" and a USAGE NOTE (e.g., "also spelled '...')."
- Prefer regional canonicals when applicable: for Caribbean/Venezuela prefer "mamagüevo"; alternatively accept "mamahuevo" as a common orthographic variant (omit dieresis).
- Treat dieresis on 'güe' as orthographic; accept both "güe" and "gue" variants. Accept texting substitution "w" → "hu" (e.g., "webo" → "huevo").
- IMPORTANT: Maintain region labels (Caribbean, Venezuela, Puerto Rico as applicable) and register "vulgar" when appropriate.

Literal translation requirement (verb+noun vulgar compounds):
- When the headword (or any alias) is a verb+noun vulgar compound (e.g., "huele bicho" or its texting variant "welebicho"), include a FIRST sense that gives the literal morphological meaning (e.g., gloss "dicksniffer") and mark appropriate registers (at minimum ["slang","vulgar"]) and regions (e.g., Puerto Rico / Caribbean / Venezuela). Follow with idiomatic senses (e.g., jerk/asshole) after the literal sense.

${enToEsDirectives}
Normalization candidates (aliases to consider): ${this.buildNormalizationCandidates(request.text).join(', ') || '(none)'}`;

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
        'meta-llama/llama-4-maverick';

      console.log('🧠 Translation effective model:', effectiveModel);

      // For Llama 4 providers (Meta), provider returns 400 on json_schema; prefer json_object hint instead.
      const useJsonObjectFormat = /meta-llama\/llama-4/i.test(effectiveModel);
      const options: LLMOptions = {
        model: effectiveModel,
        timeout: 30000,
        requestId: `translate_${Date.now()}`,
        temperature: 0.2
      };

      const rawResult = await this.openRouterAdapter.fetchCompletion(messages, options);
      const parsedResult = this.safeParseJson(rawResult);
      if (parsedResult.entry && (!parsedResult.entry.senses?.length)) {
        console.log('Retrying because entry has no senses');
      }
      const openRouterResponse = this.transformOpenRouterResponse(parsedResult);

      // Apply safety filters
      const safeResult = this.applySafetyFilters(openRouterResponse);

      // Post-transform: ensure literal-first for known verb+noun compounds (e.g., huelebicho/welebicho)
      if ((safeResult as any)?.entry) {
        this.ensureLiteralSenseForCompounds((safeResult as any).entry, request.text);
      }
      // Reorder senses to ensure literal comes first when present
      if ((safeResult as any)?.entry?.senses?.length) {
        (safeResult as any).entry.senses = this.reorderSensesLiteralFirst((safeResult as any).entry.senses);
      }

      // Backfill synthetic entry for legacy cached responses missing entry
      if (!safeResult.entry && safeResult.definitions.length > 0) {
        safeResult.entry = {
          headword: request.text,
          pronunciation: { ipa: '' },
          part_of_speech: safeResult.definitions[0].pos ?? 'n',
          gender: null,
          inflections: [],
          senses: safeResult.definitions.map((d, idx) => ({
            sense_number: idx + 1,
            gloss: d.meaning ?? d.text ?? request.text,
            examples: (safeResult.examples ?? []).slice(idx, idx + 1).map(e => ({ es: e.text ?? request.text, en: e.translation ?? '' })),
          })),
        };
      }

      // Persist raw response for debugging
      this.persistRawResponse(request.text, parsedResult, safeResult);

      console.log('✅ Translation completed for:', request.text);

      // If the entry exists but has too few senses (e.g., only 1), force a retry prompting for full coverage.
      // Post-transform: ensure literal-first for known verb+noun compounds (e.g., huelebicho/welebicho)
      // Reorder senses to ensure literal comes first when present
      if ((safeResult as any)?.entry?.senses?.length) {
        (safeResult as any).entry.senses = this.reorderSensesLiteralFirst((safeResult as any).entry.senses);
      }

      const entrySensesCount = (safeResult as any)?.entry?.senses?.length ?? 0;
      // Retry when senses are missing or insufficient (< 3), to enumerate all common senses
      if (entrySensesCount < 3) {
        console.log(`🔁 Retry: insufficient sense coverage (${entrySensesCount}) for "${request.text}". Requesting expanded, multi-sense entry.`);
        const userPromptExpanded = `Headword: ${request.text}
Source language: ${effectiveSource}
Target language: ${effectiveTarget}
Regional preference: ${regionalContext || 'general Spanish'}
Instructions:
- Produce a single JSON object per the schema in the system prompt.
- ENUMERATE ALL COMMON SENSES as distinct items in "senses" (do NOT merge). Target 6–12 senses for polysemous nouns like "cuero".
- Keep ORDER: slang/colloquial/pejorative/vulgar FIRST; then neutral/general; then technical/archaic/localized LAST.
- Each sense MUST include at least one bilingual (es/en) example pair.
- Use compact labels for regions and registers.
- Output ONLY valid JSON, no extra text.
- Do NOT use markdown code fences (no \`\`\`json blocks).`;

        const retryMessages: LLMMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPromptExpanded }
        ];
        const rawResult2 = await this.openRouterAdapter.fetchCompletion(retryMessages, options);
        const parsedResult2 = this.safeParseJson(rawResult2);
        const result2 = this.transformOpenRouterResponse(parsedResult2);

        // Post-transform for retry: enforce literal-first insertion if missing
        if ((result2 as any)?.entry) {
          this.ensureLiteralSenseForCompounds((result2 as any).entry, request.text);
        }
        if ((result2 as any)?.entry?.senses?.length) {
          (result2 as any).entry.senses = this.reorderSensesLiteralFirst((result2 as any).entry.senses);
        }
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
      this.cache.set(cacheKey, { data: safeResult, timestamp: Date.now() });
      console.log(`💾 Cached translation result for "${request.text}" (definitions: ${safeResult.definitions?.length || 0}, hasEntry: ${!!safeResult.entry})`);

      // Metrics: Increment success counter
      this.metrics.successes.inc();

      return safeResult;
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

  /**
   * Reorder senses so that 'literal' is highest priority, followed by
   * slang/colloquial/pejorative/vulgar, then neutral/general, then technical/archaic/localized.
   * This ensures literal translations like "dicksniffer" appear first for compounds (e.g., huelebicho/welebicho).
   */
  private reorderSensesLiteralFirst(senses: any[]): any[] {
    const rank = (s: any): number => {
      const regs: string[] = Array.isArray(s?.registers) ? s.registers.map((r: any) => String(r || '').toLowerCase()) : [];
      const has = (k: string) => regs.includes(k);
      // 0: literal (regardless of other tags)
      if (has('literal')) return 0;
      // 1: strong slang markers
      if (has('slang') || has('colloquial') || has('pejorative') || has('vulgar')) return 1;
      // 3: technical/specialized/archaic/localized last
      if (has('technical') || has('archaic') || has('localized') || has('regionalism')) return 3;
      // 2: neutral/general
      return 2;
    };
    return [...senses].sort((a, b) => rank(a) - rank(b));
  }

  /**
   * Best-effort JSON sanitizer and parser to handle models that emit code fences or extra text.
   */
  private safeParseJson(raw: string): any {
    if (!raw || typeof raw !== 'string') {
      throw new Error('Empty or non-string completion from provider');
    }
    // 1) Strip common markdown code fences
    let s = raw.trim()
      .replace(/^\s*```json\s*/i, '')
      .replace(/^\s*```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    // 2) Extract the outermost JSON object braces
    const firstBrace = s.indexOf('{');
    const lastBrace = s.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      s = s.slice(firstBrace, lastBrace + 1);
    }
    // 3) Attempt parse
    try {
      return JSON.parse(s);
    } catch (e1) {
      // 4) Lightweight repairs: trailing commas
      let repaired = s.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      // 5) Remove BOM or stray control chars
      repaired = repaired.replace(/^\uFEFF/, '').replace(/[\u0000-\u001F]+/g, ' ');
      try {
        return JSON.parse(repaired);
      } catch (e2) {
        // 6) As a last resort, try to find the largest JSON-looking substring
        const match = repaired.match(/{[\s\S]*}/);
        if (match) {
          try {
            return JSON.parse(match[0]);
          } catch {}
        }
        // Give up and bubble up error; caller will handle fallback
        throw new Error(`Failed to parse model JSON safely: ${String(e2)}`);
      }
    }
  }

  /**
   * Generate normalization alias candidates for slang/SMS spellings to guide the LLM.
   * Example: "mamawebo" -> ["mamahuevo","mamagüevo","mamaguevo","mamahuebo","mamaguebo"]
   * Rules applied conservatively to avoid over-normalization:
   * - "we" → "hue" (common SMS: w ≈ hu)
   * - "huev" ↔ "güev" (dieresis variant; both are observed regionally)
   * - "güe" ↔ "gue" (omit/add dieresis)
   */
  private buildNormalizationCandidates(input: string): string[] {
    try {
      const term = (input || '').toLowerCase().trim();
      if (!term) return [];
      const out = new Set<string>();

      const add = (s: string) => {
        const t = s.toLowerCase();
        if (t && t !== term) out.add(t.normalize('NFC'));
      };

      // Base: w → hu (limited to 'we' cluster to avoid overshoot)
      if (term.includes('we')) add(term.replace(/we/g, 'hue'));

      // If we have huevo forms, offer güevo and guevo variants
      if (term.includes('huevo')) {
        add(term.replace(/huevo/g, 'güevo')); // mamahuevo -> mamagüevo
        add(term.replace(/huevo/g, 'guevo')); // mamahuevo -> mamaguevo
      }
      // If we have webo, offer huevo
      if (term.includes('webo')) {
        add(term.replace(/webo/g, 'huevo')); // mamawebo -> mamahuevo
      }
      // Huelebicho/welebicho normalization (verb+noun insult)
      if (term.includes('welebicho')) {
        add(term.replace(/welebicho/g, 'huelebicho'));
        add(term.replace(/welebicho/g, 'huele bicho'));
      }
      if (term.includes('huelebicho')) {
        add(term.replace(/huelebicho/g, 'welebicho'));
        add(term.replace(/huelebicho/g, 'huele bicho'));
      }
      if (/\bhuele\s*bicho\b/.test(term)) {
        add(term.replace(/\bhuele\s*bicho\b/g, 'huelebicho'));
        add(term.replace(/\bhuele\s*bicho\b/g, 'welebicho'));
      }

      // Offer dieresis toggles where relevant
      if (term.includes('güe')) add(term.replace(/güe/g, 'gue'));
      if (term.includes('gue')) add(term.replace(/gue/g, 'güe'));

      // Heuristic: when aliases suggest the well-known insult, ensure both canonical spellings are present
      const snapshot = Array.from(out);
      if (/(mama.*(hue|güe)vo)/.test(snapshot.join(' ')) || /(mamawebo)/.test(term)) {
        add('mamagüevo');
        add('mamahuevo');
      }

      // Minor variants some communities use (less standard but seen in SMS/UD entries)
      if (term.includes('webo')) add(term.replace(/webo/g, 'huebo')); // mamawebo -> mamahuebo
      if (term.includes('guevo')) add(term.replace(/guevo/g, 'güevo')); // mamaguevo -> mamagüevo

      return Array.from(out);
    } catch {
      return [];
    }
  }

  /**
   * Minimal JSON Schema to coax a DictionaryEntry-style output.
   * Provider may ignore, but harmless if unsupported.
   */
  private getDictionaryEntryJsonSchema(): any {
    return {
      name: "DictionaryEntry",
      schema: {
        type: "object",
        properties: {
          headword: { type: "string" },
          pronunciation: {
            type: "object",
            properties: {
              ipa: { type: "string" },
              syllabification: { type: "string" }
            },
            required: ["ipa"]
          },
          part_of_speech: { type: "string" },
          gender: { type: ["string", "null"], enum: ["m", "f", "mf", null] },
          inflections: { type: "array", items: { type: "string" } },
          senses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sense_number: { type: "number" },
                registers: { type: "array", items: { type: "string" } },
                regions: { type: "array", items: { type: "string" } },
                gloss: { type: "string" },
                usage_notes: { type: "string" },
                examples: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { es: { type: "string" }, en: { type: "string" } },
                    required: ["es", "en"],
                  },
                },
                synonyms: { type: "array", items: { type: "string" } },
                antonyms: { type: "array", items: { type: "string" } },
                cross_references: { type: "array", items: { type: "string" } },
                // New: explicit Spanish translation field per sense (optional)
                translation_es: { type: "string" },
              },
              required: ["gloss", "examples"],
            },
          },
        },
        required: ["headword", "pronunciation", "senses"],
      },
      strict: false,
    };
  }

  // Map DictionaryEntry -> legacy fields for backward compatibility with existing UI
  private mapEntryToLegacy(entry: DictionaryEntry): TranslationResponse {
    const pos = entry.part_of_speech || undefined;

    const definitions = entry.senses.map((s) => {
      const usageLabels = (s.registers || []).join(', ');
      const examplesStrings = (s.examples || []).map((ex) => `${ex.es} — ${ex.en}`);
      // Prefer explicit Spanish translation if provided for EN→ES visibility
      const spanishSense = (s as any).translation_es && String((s as any).translation_es).trim()
        ? String((s as any).translation_es).trim()
        : undefined;
      const primaryText = spanishSense || s.gloss;

      return {
        text: primaryText,          // Show Spanish translation when available
        meaning: primaryText,       // Mirror in meaning for legacy consumers
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
    let purgedCount = 0;
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
        purgedCount++;
      }
    }
    if (purgedCount > 0) {
      console.log(`🧹 Purged ${purgedCount} expired cache entries`);
    }
  }

  // Debug method to persist raw responses for analysis
  persistRawResponse(query: string, rawResponse: any, transformedResponse: TranslationResponse): void {
    try {
      const debugEntry = {
        timestamp: new Date().toISOString(),
        query,
        rawResponseLength: JSON.stringify(rawResponse).length,
        transformedDefinitionsCount: transformedResponse.definitions?.length || 0,
        hasEntry: !!transformedResponse.entry,
        rawResponse: process.env.NODE_ENV === 'development' ? rawResponse : '[redacted in production]',
      };
      console.log('🔍 Raw response debug:', JSON.stringify(debugEntry, null, 2));
    } catch (error) {
      console.warn('Failed to persist raw response debug info:', error);
    }
  }

  // Synthesize definitions from entry senses when definitions are missing
  private synthesizeDefinitionsFromEntry(entry: DictionaryEntry): Array<{
    text?: string;
    meaning?: string;
    partOfSpeech?: string;
    pos?: string;
    examples?: string[];
    usage?: string;
  }> {
    if (!entry.senses || entry.senses.length === 0) {
      return [{
        text: entry.headword,
        meaning: 'No definition available',
        pos: entry.part_of_speech || 'unknown',
        usage: 'synthesized'
      }];
    }

    return entry.senses.map((sense, index) => {
      const usageLabels = [
        ...(sense.registers || []).map(r => r.toLowerCase()),
        ...(sense.regions || []).map(r => r.toLowerCase())
      ].join(', ');

      const examples = (sense.examples || []).map(ex => `${ex.es} — ${ex.en}`);

      return {
        text: sense.gloss,
        meaning: sense.gloss,
        partOfSpeech: entry.part_of_speech,
        pos: entry.part_of_speech,
        examples: examples.length > 0 ? examples : undefined,
        usage: usageLabels || undefined
      };
    });
  }

  /**
   * Ensure a literal morphological sense appears for known verb+noun vulgar compounds
   * when the model omits it. Example: "welebicho" / "huelebicho" / "huele bicho"
   * => insert literal sense "dicksniffer" with registers ['literal','slang','vulgar'].
   */
  private ensureLiteralSenseForCompounds(entry: any, originalText: string) {
    try {
      if (!entry) return;
      const headword = String(entry.headword || '').toLowerCase();
      const orig = String(originalText || '').toLowerCase();
      const xrefs: string[] = Array.isArray(entry?.senses?.[0]?.cross_references)
        ? entry.senses[0].cross_references.map((x: any) => String(x || '').toLowerCase())
        : [];

      // Match any of the known variants in headword, original query, or first sense cross refs
      const matchesWelebicho =
        /\bwelebicho\b/.test(headword) || /\bhuelebicho\b/.test(headword) || /\bhuele\s*bicho\b/.test(headword) ||
        /\bwelebicho\b/.test(orig)     || /\bhuelebicho\b/.test(orig)     || /\bhuele\s*bicho\b/.test(orig)     ||
        xrefs.some((r) => /\b(welebicho|huelebicho|huele\s*bicho)\b/.test(r));

      if (!matchesWelebicho) return;

      const senses: any[] = Array.isArray(entry.senses) ? entry.senses : [];
      const hasLiteral =
        senses.some((s) => Array.isArray(s?.registers) && s.registers.map((r: any) => String(r || '').toLowerCase()).includes('literal')) ||
        senses.some((s) => typeof s?.gloss === 'string' && /dick\s*sniffer|dicksniffer|penis\s*sniffer/i.test(s.gloss || ''));
      if (hasLiteral) return;

      // Insert literal sense at the front
      const literalSense = {
        sense_number: 1,
        registers: ['literal', 'slang', 'vulgar'],
        regions: ['Puerto Rico', 'Caribbean', 'Venezuela'],
        gloss: 'dicksniffer',
        usage_notes: 'Literal morphological reading of "huele bicho" (oler + bicho). Highly offensive regional slang.',
        examples: [
          { es: 'Ese welebicho anda hablando babosadas.', en: 'That dicksniffer is talking nonsense.' }
        ],
        synonyms: [],
        antonyms: [],
        cross_references: Array.from(new Set([
          'huele bicho',
          'huelebicho',
          'welebicho'
        ]))
      };

      entry.senses = [literalSense, ...senses].map((s: any, i: number) => ({ ...s, sense_number: i + 1 }));
    } catch {
      // no-op on safe guard
    }
  }

  /**
   * Safety filter to check for unsafe content in dictionary outputs
   */
  private containsUnsafeContent(text: string): boolean {
    // Check for sensitive patterns
    const unsafePatterns = [
      /\b(?:ssn|social.security)\b/i,
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN format
      /\b\d{9}\b/, // 9-digit numbers that might be SSNs
    ];
    
    return unsafePatterns.some(pattern => pattern.test(text));
  }

  /**
   * Apply safety filters to translation response
   */
  private applySafetyFilters(result: TranslationResponse): TranslationResponse {
    const resultString = JSON.stringify(result);
    if (this.containsUnsafeContent(resultString)) {
      console.warn('⚠️ Unsafe dictionary content detected, quarantining result');
      // Return a safe fallback
      return {
        definitions: [{
          text: 'Content filtered for safety',
          meaning: 'Content filtered for safety',
          pos: 'filtered',
          usage: 'safety'
        }],
        examples: [],
        conjugations: {},
        audio: { ipa: '', suggestions: [] },
        related: { synonyms: [], antonyms: [] }
      };
    }
    return result;
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