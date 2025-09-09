"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LangDBAdapter = void 0;
const llmAdapter_1 = require("./llmAdapter");
class LangDBAdapter extends llmAdapter_1.BaseLLMAdapter {
    constructor() {
        super(...arguments);
        this.activeRequests = new Map();
        this.activeStreams = new Map();
    }
    async *streamCompletion(messages, options) {
        const controller = new AbortController();
        const requestId = options.requestId || `req_${Date.now()}`;
        this.activeRequests.set(requestId, controller);
        let response = null;
        try {
            // Add timeout to prevent hanging requests
            const timeoutId = setTimeout(() => {
                console.warn(`Request ${requestId} timed out, aborting...`);
                controller.abort();
            }, options.timeout || 30000); // Use same default as chat service
            // Use native fetch (Node.js 18+)
            response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: options.model,
                    messages,
                    stream: true,
                    max_tokens: 1000,
                    temperature: 0.7,
                }),
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
        const controller = new AbortController();
        const requestId = options.requestId || `req_${Date.now()}`;
        this.activeRequests.set(requestId, controller);
        try {
            // Add timeout to prevent hanging requests
            const timeoutId = setTimeout(() => {
                console.warn(`Request ${requestId} timed out, aborting...`);
                controller.abort();
            }, options.timeout || 30000); // 30 second default timeout
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: options.model,
                    messages,
                    stream: false,
                    max_tokens: 1000,
                    temperature: 0.7,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LangDB API error: ${response.status} ${errorText}`);
            }
            const data = await response.json();
            return data.choices?.[0]?.message?.content || '';
        }
        catch (error) {
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                console.log(`Request ${requestId} was cancelled`);
                return '';
            }
            else {
                console.error(`Completion error for ${requestId}:`, {
                    error: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });
                // On error, return empty string so callers always get a string
                return '';
            }
        }
        finally {
            // Ensure cleanup happens even if error occurs
            this.activeRequests.delete(requestId);
        }
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
            model: 'gpt-4', // Use GPT-4 for better translation quality
            timeout: 30000,
            requestId: `translate_${Date.now()}`
        };
        const response = await this.fetchCompletion(messages, options);
        try {
            return JSON.parse(response);
        }
        catch (error) {
            console.error('Failed to parse translator JSON response:', error);
            // Return fallback structure
            return {
                definitions: [{ meaning: 'Translation unavailable', pos: 'unknown', usage: 'general' }],
                examples: [],
                conjugations: {},
                audio: { ipa: '', suggestions: [] },
                related: { synonyms: [], antonyms: [] }
            };
        }
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
//# sourceMappingURL=langdbAdapter.js.map