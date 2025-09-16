import { BaseLLMAdapter } from './llmAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';

export class LangDBAdapter extends BaseLLMAdapter {
  private model: string;
  private activeRequests: Map<string, AbortController> = new Map();
  private activeStreams: Map<string, { reader: ReadableStreamDefaultReader<Uint8Array>; decoder: TextDecoder; controller: AbortController }> = new Map();
  private readonly MAX_RETRIES = 5; // Increased from 3
  private readonly RETRY_BASE_DELAY = 2000; // Increased base delay
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  private dnsCache: Map<string, { ip: string; timestamp: number }> = new Map();
  private readonly DNS_CACHE_TTL = 1000 * 60 * 5; // 5 minutes
  private connectionPool: Map<string, { agent: any; lastUsed: number }> = new Map();
  private readonly CONNECTION_POOL_TTL = 1000 * 60 * 10; // 10 minutes
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
  private consecutiveFailures = 0;
  private readonly CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 1000 * 60 * 2; // 2 minutes
  private lastFailureTime = 0;

  constructor(apiKey: string, baseUrl: string) {
    super(apiKey, baseUrl);

    if (!apiKey) {
      throw new Error('LANGDB_API_KEY is required for LangDBAdapter');
    }
    if (!baseUrl) {
      throw new Error('LANGDB_GATEWAY_URL is required for LangDBAdapter');
    }

    let model = process.env.LANGDB_MODEL || 'openai/gpt-5-mini';
    if (!['gpt-4o-mini', 'llama-3.1-8b', 'openai/gpt-4o-mini', 'openai/gpt-5-mini'].includes(model)) {
      console.warn(`Invalid LANGDB_MODEL "${model}"; defaulting to "openai/gpt-5-mini" (verify LangDB support)`);
      model = 'openai/gpt-5-mini';
    }
    this.model = model;

    console.log('LangDBAdapter initialized with tenant URL:', baseUrl, 'model:', model);
  }

  // Circuit breaker implementation
  private shouldAllowRequest(): boolean {
    const now = Date.now();

    switch (this.circuitBreakerState) {
      case 'closed':
        return true;
      case 'open':
        if (now - this.lastFailureTime > this.CIRCUIT_BREAKER_TIMEOUT) {
          console.log('🔄 Circuit breaker transitioning to half-open');
          this.circuitBreakerState = 'half-open';
          return true;
        }
        console.log('🚫 Circuit breaker is open, rejecting request');
        return false;
      case 'half-open':
        return true;
      default:
        return true;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitBreakerState === 'half-open') {
      console.log('✅ Circuit breaker transitioning to closed');
      this.circuitBreakerState = 'closed';
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      console.log('🚫 Circuit breaker transitioning to open');
      this.circuitBreakerState = 'open';
    }
  }

  // DNS resolution with caching and retry logic
  private async resolveDNSWithRetry(hostname: string, maxRetries: number = 3): Promise<string> {
    const cached = this.dnsCache.get(hostname);
    if (cached && Date.now() - cached.timestamp < this.DNS_CACHE_TTL) {
      console.log(`DNS cache hit for ${hostname}: ${cached.ip}`);
      return cached.ip;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`DNS resolution attempt ${attempt}/${maxRetries} for ${hostname}`);
        const dns = await import('dns');
        const address = await dns.promises.lookup(hostname);
        const ip = address.address;
        console.log(`DNS resolution success for ${hostname}: ${ip}`);

        // Cache the result
        this.dnsCache.set(hostname, { ip, timestamp: Date.now() });
        return ip;
      } catch (error: any) {
        console.warn(`DNS resolution attempt ${attempt} failed for ${hostname}:`, error.message);
        if (attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt - 1); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`DNS resolution failed for ${hostname} after ${maxRetries} attempts`);
  }

  // Connection pooling for better performance
  private getConnectionAgent(url: string): any {
    const cached = this.connectionPool.get(url);
    if (cached && Date.now() - cached.lastUsed < this.CONNECTION_POOL_TTL) {
      cached.lastUsed = Date.now();
      return cached.agent;
    }

    // Create new agent (using keep-alive for Node.js)
    const agent = {
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 10,
      maxFreeSockets: 5
    };

    this.connectionPool.set(url, { agent, lastUsed: Date.now() });
    return agent;
  }

  // Clean up expired connections and DNS cache
  private cleanupResources(): void {
    const now = Date.now();

    // Clean DNS cache
    for (const [hostname, entry] of this.dnsCache.entries()) {
      if (now - entry.timestamp > this.DNS_CACHE_TTL) {
        this.dnsCache.delete(hostname);
      }
    }

    // Clean connection pool
    for (const [url, entry] of this.connectionPool.entries()) {
      if (now - entry.lastUsed > this.CONNECTION_POOL_TTL) {
        this.connectionPool.delete(url);
      }
    }
  }

  async *streamCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): AsyncIterable<DeltaChunk> {
    const requestId = options.requestId || `req_${Date.now()}`;
    let response: Response | null = null;
    let controller = new AbortController();

    try {
      // Environment-based timeout
      const timeoutMs = parseInt(process.env.LANGDB_TIMEOUT || '90000');
      const timeoutId = setTimeout(() => {
        console.warn(`Request ${requestId} timed out, aborting...`);
        controller.abort();
      }, timeoutMs);

      // Model-specific parameter mapping for gpt-5-mini
      const isGpt5Mini = options.model === 'openai/gpt-5-mini';
      const maxTokensParam = isGpt5Mini ? 'max_completion_tokens' : 'max_tokens';

      const bodyParams = {
        model: options.model,
        messages,
        stream: true,
        [maxTokensParam]: 1000,
      };

      if (!isGpt5Mini) {
        bodyParams.temperature = 0.7;
      }

      // Use native fetch (Node.js 18+) with default keep-alive (undici handles internally)
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyParams),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LangDB API error: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      // Use proper streaming with native ReadableStream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Store stream resources for cleanup
      this.activeStreams.set(requestId, { reader, decoder, controller });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines from buffer
          while (true) {
            const lineEnd = buffer.indexOf('\n');
            if (lineEnd === -1) break;

            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                yield { isFinal: true };
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                if (delta?.content !== undefined) {
                  yield {
                    deltaText: delta.content || '',  // Send empty string instead of skipping
                    isFinal: false,
                    meta: {
                      usage: parsed.usage,
                      requestId: parsed.id
                    }
                  };
                }
              } catch (parseError) {
                // Skip invalid JSON lines but log for debugging
                console.warn(`Failed to parse streaming response for ${requestId}:`, parseError instanceof Error ? parseError.message : String(parseError));
              }
            }
          }
        }
      } finally {
        // Ensure reader is always released
        if (reader) {
          try {
            await reader.cancel();
          } catch (cancelError) {
            console.warn(`Failed to cancel reader for ${requestId}:`, cancelError);
          }
        }
        // Clean up stream resources
        this.activeStreams.delete(requestId);
      }
    } catch (error: any) {
      // Handle abort errors properly
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        console.log(`Request ${requestId} was cancelled`);
      } else {
        console.error(`Streaming error for ${requestId}:`, {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        throw error;
      }
    } finally {
      // Ensure cleanup happens even if error occurs
      this.activeRequests.delete(requestId);
    }
  }

  async fetchCompletion(
    messages: LLMMessage[],
    options: LLMOptions
  ): Promise<string> {
    // Validate environment variables
    if (!this.apiKey) {
      throw new Error('LANGDB_API_KEY environment variable is required');
    }
    if (!this.baseUrl) {
      throw new Error('LANGDB_GATEWAY_URL environment variable is required');
    }

    // Check circuit breaker
    if (!this.shouldAllowRequest()) {
      throw new Error('Circuit breaker is open - LangDB service temporarily unavailable');
    }

    let lastError: any = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      const controller = new AbortController(); // New controller for each attempt
      const requestId = options.requestId || `req_${Date.now()}`;
      this.activeRequests.set(requestId, controller);

      try {
        console.log(`🔄 LangDB fetch attempt ${attempt}/${this.MAX_RETRIES} for ${requestId}: ${this.baseUrl}/chat/completions`);

        // Add timeout to prevent hanging requests
        const timeoutMs = parseInt(process.env.LANGDB_TIMEOUT || '90000');
        const timeoutId = setTimeout(() => {
          console.warn(`Request ${requestId} attempt ${attempt} timed out, aborting...`);
          controller.abort();
        }, timeoutMs);

        // Model-specific parameter mapping for gpt-5-mini
        const isGpt5Mini = options.model === 'openai/gpt-5-mini';
        const maxTokensParam = isGpt5Mini ? 'max_completion_tokens' : 'max_tokens';

        const bodyParams = {
          model: options.model,
          messages,
          stream: false,
          [maxTokensParam]: 1000,
        };

        if (!isGpt5Mini) {
          bodyParams.temperature = 0.7;
        }

        // Log full request details for debugging
        console.log('🔍 Full LangDB request details:', {
          url: `${this.baseUrl}/chat/completions`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey ? '[REDACTED]' : 'MISSING'}`,
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
            'Keep-Alive': 'timeout=30',
          },
          bodyPreview: JSON.stringify(bodyParams).substring(0, 200) + '...',
          signal: controller.signal.aborted ? 'aborted' : 'active',
          attempt,
          requestId
        });

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyParams),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Log response details even on success
        console.log('🔍 LangDB response status:', response.status, 'content-type:', response.headers.get('content-type'));

        if (!response.ok) {
          const fullBody = await response.text();
          console.error('Full LangDB response body on failure (attempt ${attempt}):', fullBody.substring(0, 1000)); // Log full body
          lastError = new Error(`LangDB API error: ${response.status} - ${fullBody || 'Empty body'}`);
          console.error(`❌ Attempt ${attempt} failed:`, lastError.message);
          console.error('Response details:', {
            status: response.status,
            statusText: response.statusText,
            body: fullBody
          });
          if (attempt < this.MAX_RETRIES) {
            const delay = this.RETRY_BASE_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw lastError;
        }

        const data: any = await response.json();
        console.log(`✅ LangDB fetch success on attempt ${attempt} for ${requestId}: keys: ${Object.keys(data)}`);

        // Record success for circuit breaker
        this.recordSuccess();

        return data.choices?.[0]?.message?.content || '';
      } catch (error: any) {
        lastError = error;
        console.error(`❌ LangDB fetch attempt ${attempt} failed for ${requestId}:`, {
          message: error.message,
          name: error.name,
          code: error.code, // e.g., 'UND_ERR_CONNECTING' for network
          errno: error.errno, // Node.js error code
          syscall: error.syscall, // e.g., 'fetch' or 'connect'
          address: error.address, // Target address
          port: error.port, // Target port
          stack: error.stack
        });

        // Record failure for circuit breaker
        this.recordFailure();

        if (attempt < this.MAX_RETRIES) {
          const delay = this.RETRY_BASE_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw lastError;
      } finally {
        this.activeRequests.delete(requestId);
      }
    }
    return '';
  }

  /**
    * Translator mode: Generate structured JSON output for translation queries
    * Enhanced prompt engineering for comprehensive spanishdict.com-like results
    * @param text The text to translate
    * @param sourceLang Source language (e.g., 'es')
    * @param targetLang Target language (e.g., 'en')
    * @param context Optional regional context (e.g., 'mex' for Mexican Spanish)
    * @returns Promise resolving to structured translation JSON
    */
  async translateStructured(
    text: string,
    sourceLang: string,
    targetLang: string,
    context?: string
  ): Promise<any> {
    // Enhanced system prompt with detailed instructions for structured output
    const systemPrompt = `You are an expert Spanish-English translator specializing in comprehensive linguistic analysis. You must output ONLY valid JSON with this exact structure:

{
  "definitions": [
    {
      "text": "exact word/phrase being defined",
      "partOfSpeech": "noun|verb|adjective|adverb|interjection|conjunction|preposition",
      "meaning": "clear English definition",
      "examples": ["example sentence 1", "example sentence 2"],
      "usage": "formal|informal|slang|colloquial|literary",
      "regional": "general|mexico|argentina|spain|colombia|etc"
    }
  ],
  "examples": [
    {
      "text": "original Spanish text",
      "translation": "English translation",
      "context": "brief usage context or situation"
    }
  ],
  "conjugations": {
    "tense": {
      "yo": "first person singular",
      "tú": "second person singular informal",
      "él/ella": "third person singular",
      "nosotros": "first person plural",
      "vosotros": "second person plural informal (Spain)",
      "ellos/ellas": "third person plural"
    }
  },
  "audio": [
    {
      "url": "suggested audio file path or URL",
      "pronunciation": "IPA phonetic transcription",
      "region": "accent/dialect specification"
    }
  ],
  "related": [
    {
      "word": "related word",
      "type": "synonym|antonym|related|cognate",
      "relation": "brief explanation of relationship"
    }
  ]
}

CRITICAL INSTRUCTIONS:
1. Output ONLY valid JSON - no markdown, no explanations, no additional text
2. Include regional variations when context is provided (e.g., Mexican Spanish uses different vocabulary)
3. Provide multiple definitions if the word has different meanings
4. Include conjugations only for verbs, set to empty object {} for non-verbs
5. Always include at least 2-3 examples with natural usage
6. Use accurate IPA pronunciation when possible
7. Include synonyms, antonyms, and related terms when relevant
8. Consider formality levels and usage contexts`;

    // Enhanced user prompt with specific instructions
    const userPrompt = `Translate and analyze: "${text}"

Language pair: ${sourceLang} → ${targetLang}
${context ? `Regional context: ${context} Spanish variant` : 'General Spanish context'}

Provide comprehensive analysis including:
- Multiple definitions with part of speech
- Natural usage examples
- Verb conjugations (if applicable)
- Pronunciation guidance
- Related words and synonyms
- Regional variations and formality levels

Focus on accuracy and cultural context.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const options: LLMOptions = {
      model: 'openai/gpt-5-mini',
      timeout: 90000,
      requestId: `translate_${Date.now()}`
    };

    try {
      const response = await this.fetchCompletion(messages, options);

      if (!response || response.trim() === '') {
        console.warn('Empty response from LangDB for translation:', text);
        return this.getFallbackTranslation(text, sourceLang, targetLang, context);
      }

      // Log raw response for debugging
      console.log('Raw LangDB translation response:', response.substring(0, 500) + (response.length > 500 ? '...' : ''));

      try {
        // Clean the response by removing any potential markdown or extra text
        let cleanResponse = response.trim();

        // Remove potential markdown code blocks
        if (cleanResponse.startsWith('```json')) {
          cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanResponse.startsWith('```')) {
          cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        // Parse the cleaned JSON response
        const structured = JSON.parse(cleanResponse);

        // Enhanced validation with detailed error reporting
        const validationErrors: string[] = [];

        if (!structured.definitions || !Array.isArray(structured.definitions)) {
          validationErrors.push('definitions must be an array');
        }
        if (!structured.examples || !Array.isArray(structured.examples)) {
          validationErrors.push('examples must be an array');
        }
        if (!structured.conjugations || typeof structured.conjugations !== 'object') {
          validationErrors.push('conjugations must be an object');
        }
        if (!structured.audio || !Array.isArray(structured.audio)) {
          validationErrors.push('audio must be an array');
        }
        if (!structured.related || !Array.isArray(structured.related)) {
          validationErrors.push('related must be an array');
        }

        if (validationErrors.length === 0) {
          console.log('✅ Valid structured translation parsed from LangDB');
          return structured;
        } else {
          console.warn('Invalid LangDB structure:', validationErrors.join(', '));
          console.warn('Received structure:', {
            hasDefinitions: !!structured.definitions,
            definitionsType: Array.isArray(structured.definitions) ? 'array' : typeof structured.definitions,
            hasExamples: !!structured.examples,
            examplesType: Array.isArray(structured.examples) ? 'array' : typeof structured.examples,
            hasConjugations: !!structured.conjugations,
            conjugationsType: typeof structured.conjugations,
            hasAudio: !!structured.audio,
            audioType: Array.isArray(structured.audio) ? 'array' : typeof structured.audio,
            hasRelated: !!structured.related,
            relatedType: Array.isArray(structured.related) ? 'array' : typeof structured.related
          });
          return this.getFallbackTranslation(text, sourceLang, targetLang, context);
        }
      } catch (parseError) {
        console.error('JSON parse error in translateStructured:', parseError instanceof Error ? parseError.message : String(parseError));
        console.error('Raw response that failed to parse:', response.substring(0, 1000));
        return this.getFallbackTranslation(text, sourceLang, targetLang, context);
      }
    } catch (error: any) {
      console.error('Translation fetch error:', error.message, error.stack);
      return this.getFallbackTranslation(text, sourceLang, targetLang, context);
    }
  }

  private getFallbackTranslation(text: string, sourceLang: string, targetLang: string, context?: string): any {
    console.log('🔄 Using fallback translation for:', text, 'due to LangDB failure');
    return {
      definitions: [
        {
          text: `Error: "${text}" (both services unavailable)`,
          meaning: `Error: "${text}" (both services unavailable)`,
          pos: 'unknown',
          usage: 'error'
        }
      ],
      examples: [],
      conjugations: {},
      audio: { ipa: '', suggestions: [] },
      related: { synonyms: [], antonyms: [] }
    };
  }

  cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
    // Also clean up DNS and connection resources
    this.cleanupResources();
  }

  async cancel(requestId: string): Promise<void> {
    const controller = this.activeRequests.get(requestId);
    const streamResources = this.activeStreams.get(requestId);

    if (controller) {
      try {
        controller.abort();
        console.log(`Request ${requestId} cancelled successfully`);
      } catch (error) {
        console.warn(`Error cancelling request ${requestId}:`, error);
      }
    }

    // Clean up stream resources
    if (streamResources) {
      try {
        const { reader } = streamResources;
        if (reader) {
          await reader.cancel();
        }
      } catch (error) {
        console.warn(`Error cleaning up stream resources for ${requestId}:`, error);
      }
    }

    // Remove from tracking maps
    this.activeRequests.delete(requestId);
    this.activeStreams.delete(requestId);
  }
}

// Singleton instance
export const translationService = new LangDBAdapter(
  process.env.LANGDB_API_KEY || '',
  process.env.LANGDB_GATEWAY_URL || 'https://api.us-east-1.langdb.ai/v1'
);

// Periodic cache cleanup
setInterval(() => {
  translationService.cleanupCache();
}, 1000 * 60 * 5); // Every 5 minutes
