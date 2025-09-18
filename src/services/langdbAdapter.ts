import { BaseLLMAdapter } from './llmAdapter';
import { OpenRouterAdapter } from './openrouterAdapter';
import { LLMMessage, DeltaChunk, LLMOptions } from '../types';

export class LangDBAdapter extends BaseLLMAdapter {
  private model: string;
  private activeRequests: Map<string, AbortController> = new Map();
  private activeStreams: Map<string, { reader: ReadableStreamDefaultReader<Uint8Array>; decoder: TextDecoder; controller: AbortController }> = new Map();
  private readonly MAX_RETRIES = 2; // Reduced for faster fallback
  private readonly RETRY_BASE_DELAY = 500; // Reduced for faster retries
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  private dnsCache: Map<string, { ip: string; timestamp: number }> = new Map();
  private readonly DNS_CACHE_TTL = 1000 * 60 * 5; // 5 minutes
  private connectionPool: Map<string, { agent: any; lastUsed: number }> = new Map();
  private readonly CONNECTION_POOL_TTL = 1000 * 60 * 10; // 10 minutes
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
  private consecutiveFailures = 0;
  private consecutive504Failures = 0; // Separate counter for 504 errors
  private readonly CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
  private readonly CIRCUIT_BREAKER_504_THRESHOLD = 3; // Allow 3 retries for 504 before opening
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

    console.log('LangDBAdapter initialized with tenant URL:', baseUrl.trim(), 'model:', model);
  }

  // Circuits breaker implementation
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
    this.consecutive504Failures = 0; // Reset 504 counter on success
    if (this.circuitBreakerState === 'half-open') {
      console.log('✅ Circuit breaker transitioning to closed');
      this.circuitBreakerState = 'closed';
    }
  }

  // Add specific 504 error detection
  private isGatewayTimeout(error: any): boolean {
    return error.message.includes('504') || error.message.includes('Gateway Timeout');
  }

  private recordFailure(lastError?: any): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    console.log('🔍 Circuit breaker recordFailure debug:', {
      consecutiveFailures: this.consecutiveFailures,
      consecutive504Failures: this.consecutive504Failures,
      hasLastError: !!lastError,
      errorMessage: lastError?.message,
      isGatewayTimeout: lastError ? this.isGatewayTimeout(lastError) : false,
      currentState: this.circuitBreakerState
    });

    // Handle 504 errors with separate retry logic
    if (lastError && this.isGatewayTimeout(lastError)) {
      this.consecutive504Failures++;
      console.log(`🚫 504 Gateway Timeout detected (${this.consecutive504Failures}/${this.CIRCUIT_BREAKER_504_THRESHOLD})`);

      // Only open circuit after 3 consecutive 504 failures
      if (this.consecutive504Failures >= this.CIRCUIT_BREAKER_504_THRESHOLD) {
        console.log('🚫 Circuit breaker opening due to 504 threshold exceeded');
        this.circuitBreakerState = 'open';
      }
      return;
    }

    // Reset 504 counter on non-504 failures
    this.consecutive504Failures = 0;

    if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      console.log('🚫 Circuit breaker transitioning to open due to general failure threshold');
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
      const timeoutMs = parseInt(process.env.LANGDB_TIMEOUT || '120000');
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

      // Log request details for debugging
      console.log('🔍 StreamCompletion request details:', {
        url: `${this.baseUrl}/chat/completions`,
        bodySize: JSON.stringify(bodyParams).length,
        headers: { Authorization: '[REDACTED]', 'Content-Type': 'application/json', 'User-Agent': 'KLK-App/1.0' },
        stream: true,
        model: options.model,
        messageCount: messages.length,
        totalTokensEst: JSON.stringify(messages).length + 1000, // Approximate
        requestId: options.requestId
      });

      // Use native fetch with retry logic for streaming
      let response: Response | null = null;
      let lastError: any = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`🔄 StreamCompletion fetch attempt ${attempt}/3 for ${options.requestId}`);

          response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'User-Agent': 'KLK-App/1.0',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Keep-Alive': 'timeout=30, max=1000',
            },
            body: JSON.stringify(bodyParams),
            signal: controller.signal,
          });

          // Success, break retry loop
          break;
        } catch (error: any) {
          lastError = error;
          console.error(`❌ StreamCompletion fetch attempt ${attempt} failed:`, error.message);

          // Don't retry on abort or non-network errors
          if (error.name === 'AbortError' || !error.message.includes('fetch failed')) {
            throw error;
          }

          if (attempt < 3) {
            const delay = 1000 * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s
            console.log(`⏳ Retrying stream fetch in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!response) {
        throw lastError || new Error('All stream fetch attempts failed');
      }

      clearTimeout(timeoutId);

      // Log response details
      console.log('🔍 StreamCompletion response details:', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        requestId: options.requestId
      });

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
        const timeoutMs = parseInt(process.env.LANGDB_TIMEOUT || '120000');
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
            'User-Agent': 'KLK-App/1.0',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Keep-Alive': 'timeout=30, max=1000',
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
        this.recordFailure(lastError);

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
    // Optimized system prompt with essential JSON schema (trimmed for faster generation)
    const systemPrompt = `You are an expert Spanish-English translator. Output ONLY valid JSON:

{
  "definitions": [{"text": "word", "partOfSpeech": "noun|verb|adj", "meaning": "definition", "examples": ["ex1"], "usage": "formal|informal", "regional": "general"}],
  "examples": [{"text": "Spanish", "translation": "English", "context": "usage"}],
  "conjugations": {"tense": {"yo": "form", "tú": "form"}},
  "audio": [{"url": "url", "pronunciation": "IPA", "region": "accent"}],
  "related": [{"word": "word", "type": "synonym", "relation": "explanation"}]
}

CRITICAL: Output ONLY JSON. Include regional variations if context provided. Conjugations only for verbs. At least 2 examples.`;

    // Concise user prompt
    const userPrompt = `Translate "${text}" from ${sourceLang} to ${targetLang}${context ? ` with ${context} context` : ''}. Provide definitions, examples, conjugations (verbs only), audio, related terms.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const options: LLMOptions = {
      model: 'gpt-4o-mini', // Use gpt-4o-mini for better streaming reliability
      timeout: 120000, // Increased to 120s for structured output
      requestId: `translate_${Date.now()}`
    };

    // Check payload size - fallback to OpenRouter if too large for streaming
    const payloadSize = JSON.stringify(messages).length;
    if (payloadSize > 10000) {
      console.log(`📏 Payload size ${payloadSize} > 10000, falling back to OpenRouter for ${text}`);
      // Immediate fallback to OpenRouter
      try {
        const openRouterAdapter = new OpenRouterAdapter(process.env.OPENROUTER_API_KEY || '', process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1');
        const systemPrompt = `You are a precise Spanish-English translator. Output ONLY JSON: {
"definitions": [{"meaning": "string", "pos": "noun|verb|adj|adv", "usage": "formal|informal|slang"}],
"examples": [{"es": "Spanish example", "en": "English example", "context": "usage context"}],
"conjugations": {"present": ["yo form", "tú form", ...], "past": [...]},
"audio": {"ipa": "phonetic", "suggestions": ["audio suggestions"]},
"related": {"synonyms": ["syn1"], "antonyms": ["ant1"]}
}. Use regional variants if context provided.`;

        const userPrompt = `Translate "${text}" from ${sourceLang} to ${targetLang}${context ? ` with ${context} context` : ''}.`;
        const messages: LLMMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ];
        const options: LLMOptions = {
          model: 'gpt-4o-mini',
          timeout: 30000,
          requestId: `fallback_${Date.now()}`
        };
        const rawResult = await openRouterAdapter.fetchCompletion(messages, options);
        const fallbackResult = JSON.parse(rawResult);
        console.log('✅ OpenRouter payload fallback success for:', text);
        return fallbackResult;
      } catch (fallbackError: any) {
        console.error('❌ OpenRouter payload fallback also failed for', text, ':', fallbackError.message);
        return this.getFallbackTranslation(text, sourceLang, targetLang, context);
      }
    }

    try {
      // Use fetchCompletion with optimized headers and timeout to avoid 504
      const rawResponse = await this.fetchCompletion(messages, options);

      if (!rawResponse || rawResponse.trim() === '') {
        console.warn('Empty response from LangDB for translation:', text);
        return this.getFallbackTranslation(text, sourceLang, targetLang, context);
      }

      // Log raw response for debugging
      console.log('Raw LangDB translation response:', rawResponse.substring(0, 500) + (rawResponse.length > 500 ? '...' : ''));

      try {
        // Clean and parse JSON
        let cleanResponse = rawResponse.trim();
        if (cleanResponse.startsWith('```json')) {
          cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanResponse.startsWith('```')) {
          cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        const structured = JSON.parse(cleanResponse);

        // Validation
        const validationErrors: string[] = [];
        if (!structured.definitions || !Array.isArray(structured.definitions)) validationErrors.push('definitions array');
        if (!structured.examples || !Array.isArray(structured.examples)) validationErrors.push('examples array');
        if (!structured.conjugations || typeof structured.conjugations !== 'object') validationErrors.push('conjugations object');
        if (!structured.audio || !Array.isArray(structured.audio)) validationErrors.push('audio array');
        if (!structured.related || !Array.isArray(structured.related)) validationErrors.push('related array');

        if (validationErrors.length === 0) {
          console.log('✅ Valid structured translation parsed from LangDB');
          return structured;
        } else {
          console.warn('Invalid LangDB structure:', validationErrors.join(', '));
          return this.getFallbackTranslation(text, sourceLang, targetLang, context);
        }
      } catch (parseError) {
        console.error('JSON parse error in translateStructured:', parseError instanceof Error ? parseError.message : String(parseError));
        console.error('Raw response that failed to parse:', rawResponse.substring(0, 1000));
        return this.getFallbackTranslation(text, sourceLang, targetLang, context);
      }
    } catch (error: any) {
      console.error('Translation fetch error:', error.message, error.stack);
      // Immediate fallback to OpenRouter on any LangDB failure
      try {
        console.log('🔄 LangDB failed, implementing immediate fallback to OpenRouter for', text);
        const openRouterAdapter = new OpenRouterAdapter(process.env.OPENROUTER_API_KEY || '', process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1');
        const systemPrompt = `You are a precise Spanish-English translator. Output ONLY JSON: {
"definitions": [{"meaning": "string", "pos": "noun|verb|adj|adv", "usage": "formal|informal|slang"}],
"examples": [{"es": "Spanish example", "en": "English example", "context": "usage context"}],
"conjugations": {"present": ["yo form", "tú form", ...], "past": [...]},
"audio": {"ipa": "phonetic", "suggestions": ["audio suggestions"]},
"related": {"synonyms": ["syn1"], "antonyms": ["ant1"]}
}. Use regional variants if context provided.`;

        const userPrompt = `Translate "${text}" from ${sourceLang} to ${targetLang}${context ? ` with ${context} context` : ''}.`;
        const messages: LLMMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ];
        const options: LLMOptions = {
          model: 'gpt-4o-mini',
          timeout: 30000,
          requestId: `fallback_${Date.now()}`
        };
        const rawResult = await openRouterAdapter.fetchCompletion(messages, options);
        const fallbackResult = JSON.parse(rawResult);
        console.log('✅ OpenRouter immediate fallback success for:', text);
        return fallbackResult;
      } catch (fallbackError: any) {
        console.error('❌ OpenRouter immediate fallback also failed for', text, ':', fallbackError.message);
        return this.getFallbackTranslation(text, sourceLang, targetLang, context);
      }
    }
  }

  private getFallbackTranslation(text: string, sourceLang: string, targetLang: string, context?: string): any {
    console.log('🔄 Using fallback translation for:', text, 'due to LangDB failure');
    return {
      definitions: [{
        text: text,
        partOfSpeech: 'unknown',
        meaning: `[Service temporarily unavailable] Basic translation: ${text}`,
        examples: [`${text} (example needed)`],
        usage: 'unknown',
        regional: context || 'general'
      }],
      examples: [{
        text: `${text} - translation service temporarily unavailable`,
        translation: `${text} - translation service temporarily unavailable`,
        context: 'Service fallback mode'
      }],
      conjugations: {},
      audio: [],
      related: []
    };
  }

  // Get circuit breaker state for health monitoring
  getCircuitBreakerState(): string {
    return this.circuitBreakerState;
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
