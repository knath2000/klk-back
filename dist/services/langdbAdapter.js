"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.translationService = exports.LangDBAdapter = void 0;
const llmAdapter_1 = require("./llmAdapter");
class LangDBAdapter extends llmAdapter_1.BaseLLMAdapter {
    constructor(apiKey, baseUrl) {
        super(apiKey, baseUrl);
        this.activeRequests = new Map();
        this.activeStreams = new Map();
        this.MAX_RETRIES = 5; // Increased from 3
        this.RETRY_BASE_DELAY = 2000; // Increased base delay
        this.cache = new Map();
        this.CACHE_TTL = 1000 * 60 * 30; // 30 minutes
        this.dnsCache = new Map();
        this.DNS_CACHE_TTL = 1000 * 60 * 5; // 5 minutes
        this.connectionPool = new Map();
        this.CONNECTION_POOL_TTL = 1000 * 60 * 10; // 10 minutes
        this.circuitBreakerState = 'closed';
        this.consecutiveFailures = 0;
        this.CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
        this.CIRCUIT_BREAKER_TIMEOUT = 1000 * 60 * 2; // 2 minutes
        this.lastFailureTime = 0;
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
    shouldAllowRequest() {
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
    recordSuccess() {
        this.consecutiveFailures = 0;
        if (this.circuitBreakerState === 'half-open') {
            console.log('✅ Circuit breaker transitioning to closed');
            this.circuitBreakerState = 'closed';
        }
    }
    recordFailure() {
        this.consecutiveFailures++;
        this.lastFailureTime = Date.now();
        if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
            console.log('🚫 Circuit breaker transitioning to open');
            this.circuitBreakerState = 'open';
        }
    }
    // DNS resolution with caching and retry logic
    async resolveDNSWithRetry(hostname, maxRetries = 3) {
        const cached = this.dnsCache.get(hostname);
        if (cached && Date.now() - cached.timestamp < this.DNS_CACHE_TTL) {
            console.log(`DNS cache hit for ${hostname}: ${cached.ip}`);
            return cached.ip;
        }
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`DNS resolution attempt ${attempt}/${maxRetries} for ${hostname}`);
                const dns = await Promise.resolve().then(() => __importStar(require('dns')));
                const address = await dns.promises.lookup(hostname);
                const ip = address.address;
                console.log(`DNS resolution success for ${hostname}: ${ip}`);
                // Cache the result
                this.dnsCache.set(hostname, { ip, timestamp: Date.now() });
                return ip;
            }
            catch (error) {
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
    getConnectionAgent(url) {
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
    cleanupResources() {
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
    async *streamCompletion(messages, options) {
        const requestId = options.requestId || `req_${Date.now()}`;
        let response = null;
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
            // Use native fetch (Node.js 18+) with keep-alive headers
            response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Connection': 'keep-alive',
                    'Keep-Alive': 'timeout=30',
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
                    if (done)
                        break;
                    buffer += decoder.decode(value, { stream: true });
                    // Process complete lines from buffer
                    while (true) {
                        const lineEnd = buffer.indexOf('\n');
                        if (lineEnd === -1)
                            break;
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
                                        deltaText: delta.content || '', // Send empty string instead of skipping
                                        isFinal: false,
                                        meta: {
                                            usage: parsed.usage,
                                            requestId: parsed.id
                                        }
                                    };
                                }
                            }
                            catch (parseError) {
                                // Skip invalid JSON lines but log for debugging
                                console.warn(`Failed to parse streaming response for ${requestId}:`, parseError instanceof Error ? parseError.message : String(parseError));
                            }
                        }
                    }
                }
            }
            finally {
                // Ensure reader is always released
                if (reader) {
                    try {
                        await reader.cancel();
                    }
                    catch (cancelError) {
                        console.warn(`Failed to cancel reader for ${requestId}:`, cancelError);
                    }
                }
                // Clean up stream resources
                this.activeStreams.delete(requestId);
            }
        }
        catch (error) {
            // Handle abort errors properly
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                console.log(`Request ${requestId} was cancelled`);
            }
            else {
                console.error(`Streaming error for ${requestId}:`, {
                    error: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });
                throw error;
            }
        }
        finally {
            // Ensure cleanup happens even if error occurs
            this.activeRequests.delete(requestId);
        }
    }
    async fetchCompletion(messages, options) {
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
        let lastError = null;
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
                        'Connection': 'keep-alive',
                        'Keep-Alive': 'timeout=30',
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
                const data = await response.json();
                console.log(`✅ LangDB fetch success on attempt ${attempt} for ${requestId}: keys: ${Object.keys(data)}`);
                // Record success for circuit breaker
                this.recordSuccess();
                return data.choices?.[0]?.message?.content || '';
            }
            catch (error) {
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
            }
            finally {
                this.activeRequests.delete(requestId);
            }
        }
        return '';
    }
    /**
     * Translator mode: Generate structured JSON output for translation queries
     * @param text The text to translate
     * @param sourceLang Source language (e.g., 'es')
     * @param targetLang Target language (e.g., 'en')
     * @param context Optional regional context (e.g., 'mex' for Mexican Spanish)
     * @returns Promise resolving to structured translation JSON
     */
    async translateStructured(text, sourceLang, targetLang, context) {
        const systemPrompt = `You are a precise Spanish-English translator. Output ONLY JSON: {
"definitions": [{"meaning": "string", "pos": "noun|verb|adj|adv", "usage": "formal|informal|slang"}],
"examples": [{"es": "Spanish example", "en": "English example", "context": "usage context"}],
"conjugations": {"present": ["yo form", "tú form", ...], "past": [...], ...},
"audio": {"ipa": "phonetic", "suggestions": ["audio file suggestions"]},
"related": {"synonyms": ["syn1", "syn2"], "antonyms": ["ant1", "ant2"]}
}. Use regional variants if context provided.`;
        const userPrompt = `Translate "${text}" from ${sourceLang} to ${targetLang}${context ? ` with ${context} regional context` : ''}.`;
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
        const options = {
            model: 'openai/gpt-5-mini', // Updated to use gpt-5-mini for translation (more advanced model for structured outputs)
            timeout: 90000, // Increased for Render
            requestId: `translate_${Date.now()}`
        };
        try {
            const response = await this.fetchCompletion(messages, options);
            if (!response || response.trim() === '') {
                console.warn('Empty response from LangDB for translation:', text);
                return this.getFallbackTranslation(text, sourceLang, targetLang);
            }
            // Log raw response for debugging
            console.log('Raw LangDB translation response:', response.substring(0, 500) + (response.length > 500 ? '...' : ''));
            try {
                // Since we prompt for direct JSON output, parse the response content directly
                const structured = JSON.parse(response.trim());
                // Validate structure: must have definitions array and other expected keys
                if (structured.definitions && Array.isArray(structured.definitions) &&
                    structured.examples && Array.isArray(structured.examples) &&
                    typeof structured.conjugations === 'object' &&
                    typeof structured.audio === 'object' &&
                    typeof structured.related === 'object') {
                    console.log('✅ Valid structured translation parsed from LangDB');
                    return structured;
                }
                else {
                    console.warn('Invalid LangDB structure (missing expected keys or invalid types):', {
                        hasDefinitions: !!structured.definitions,
                        definitionsType: Array.isArray(structured.definitions) ? 'array' : typeof structured.definitions,
                        hasExamples: !!structured.examples,
                        // Add more validation logs as needed
                    });
                    return this.getFallbackTranslation(text, sourceLang, targetLang);
                }
            }
            catch (parseError) {
                console.error('JSON parse error in translateStructured:', parseError instanceof Error ? parseError.message : String(parseError), 'Raw response:', response.substring(0, 500) + (response.length > 500 ? '...' : ''));
                return this.getFallbackTranslation(text, sourceLang, targetLang);
            }
        }
        catch (error) {
            console.error('Translation fetch error:', error.message);
            return this.getFallbackTranslation(text, sourceLang, targetLang);
        }
    }
    getFallbackTranslation(text, sourceLang, targetLang) {
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
    cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.CACHE_TTL) {
                this.cache.delete(key);
            }
        }
        // Also clean up DNS and connection resources
        this.cleanupResources();
    }
    async cancel(requestId) {
        const controller = this.activeRequests.get(requestId);
        const streamResources = this.activeStreams.get(requestId);
        if (controller) {
            try {
                controller.abort();
                console.log(`Request ${requestId} cancelled successfully`);
            }
            catch (error) {
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
            }
            catch (error) {
                console.warn(`Error cleaning up stream resources for ${requestId}:`, error);
            }
        }
        // Remove from tracking maps
        this.activeRequests.delete(requestId);
        this.activeStreams.delete(requestId);
    }
}
exports.LangDBAdapter = LangDBAdapter;
// Singleton instance
exports.translationService = new LangDBAdapter(process.env.LANGDB_API_KEY || '', process.env.LANGDB_GATEWAY_URL || 'https://api.us-east-1.langdb.ai/v1');
// Periodic cache cleanup
setInterval(() => {
    exports.translationService.cleanupCache();
}, 1000 * 60 * 5); // Every 5 minutes
//# sourceMappingURL=langdbAdapter.js.map