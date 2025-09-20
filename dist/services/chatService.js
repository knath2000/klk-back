"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const personaService_1 = require("./personaService");
const conversationService_1 = require("./conversationService");
class ChatService {
    constructor(llmAdapter) {
        this.activeStreams = new Map();
        this.llmAdapter = llmAdapter;
    }
    // Response validation and quality scoring
    validateResponse(response) {
        const issues = [];
        let score = 0;
        // Minimum length check (15+ characters)
        if (response.trim().length < 15) {
            issues.push('Response too short');
            score -= 2;
        }
        else {
            score += 1;
        }
        // Check for meaningful content (not just punctuation or single words)
        const meaningfulWords = response.trim().split(/\s+/).filter(word => word.length > 2);
        if (meaningfulWords.length < 2) {
            issues.push('Insufficient meaningful content');
            score -= 1;
        }
        else {
            score += 1;
        }
        // Check for engagement indicators (questions, conversation starters)
        const hasQuestion = /[¿?]\s*[A-Za-zÀ-ÿ]/.test(response);
        const hasEngagement = /\b(qué|como|cuándo|dónde|por qué|cuál|quién)\b/i.test(response);
        const hasSlang = /\b(güey|chido|órale|qué onda|no manches|chamba|qué padre|manito|guey|papá|bebe|chulo|qué lo qué|tremendo|vaina|chévere|guagua)\b/i.test(response);
        if (hasQuestion || hasEngagement) {
            score += 2;
        }
        if (hasSlang) {
            score += 1;
        }
        else {
            issues.push('Missing regional slang');
            score -= 1;
        }
        // Check for repetitive patterns
        const words = response.toLowerCase().split(/\s+/);
        const uniqueWords = new Set(words);
        const repetitionRatio = uniqueWords.size / words.length;
        if (repetitionRatio < 0.6) {
            issues.push('High repetition detected');
            score -= 1;
        }
        return {
            isValid: score >= 0 && issues.length === 0,
            score,
            issues
        };
    }
    // Conversation context awareness
    enhanceWithContextAwareness(response, userMessage, selected_country_key) {
        // Add follow-up engagement if response lacks questions
        const hasQuestion = /[¿?]\s*[A-Za-zÀ-ÿ]/.test(response);
        const hasEngagement = /\b(qué|como|cuándo|dónde|por qué|cuál|quién)\b/i.test(response);
        if (!hasQuestion && !hasEngagement && response.length > 20) {
            // Add contextual follow-up based on user message and country
            const followUps = {
                mex: [" ¿Qué más quieres saber?", " ¿Te cuento más al respecto?", " ¿Qué opinas tú?", " ¿Quieres que te explique mejor?", " ¿Hay algo más que te interese?"],
                arg: [" ¿Qué más querés saber?", " ¿Te cuento más al respecto?", " ¿Qué opinás vos?", " ¿Querés que te explique mejor?", " ¿Hay algo más que te interese?"],
                esp: [" ¿Qué más quieres saber?", " ¿Te cuento más al respecto?", " ¿Qué opinas tú?", " ¿Quieres que te explique mejor?", " ¿Hay algo más que te interese?"],
                dom: [" ¿Qué lo qué quieres saber?", " ¿Te cuento más al respecto?", " ¿Qué opinas tú?", " ¿Quieres que te explique mejor?", " ¿Hay algo más que te interese?"]
            };
            const countryFollowUps = followUps[selected_country_key] || followUps.mex;
            const randomFollowUp = countryFollowUps[Math.floor(Math.random() * countryFollowUps.length)];
            return response.trim() + randomFollowUp;
        }
        return response;
    }
    // Enhanced logging for response process
    logResponseProcess(messageId, stage, data) {
        const timestamp = new Date().toISOString();
        console.log(`📊 [${timestamp}] RESPONSE-${stage.toUpperCase()}: ${messageId}`, data);
    }
    async handleUserMessage(socket, payload) {
        const { message, selected_country_key, client_ts, message_id, model, conversationId } = payload;
        console.log(`🤖 PROCESSING MESSAGE: ${message_id} - "${message}" for country: ${selected_country_key}`);
        this.logResponseProcess(message_id, 'start', { userMessage: message, country: selected_country_key });
        try {
            // Validate country key
            if (!personaService_1.personaService.isValidCountryKey(selected_country_key)) {
                console.error(`❌ INVALID COUNTRY KEY: ${selected_country_key}`);
                this.logResponseProcess(message_id, 'error', { type: 'invalid_country', country: selected_country_key });
                socket.emit('error', {
                    message: 'Invalid country selection',
                    code: 'INVALID_COUNTRY'
                });
                return;
            }
            // Get persona
            const persona = personaService_1.personaService.getPersona(selected_country_key);
            if (!persona) {
                console.error(`❌ PERSONA NOT FOUND: ${selected_country_key}`);
                this.logResponseProcess(message_id, 'error', { type: 'persona_not_found', country: selected_country_key });
                socket.emit('error', {
                    message: 'Persona not found',
                    code: 'PERSONA_NOT_FOUND'
                });
                return;
            }
            console.log(`✅ USING PERSONA: ${persona.displayName} (${persona.country_key})`);
            this.logResponseProcess(message_id, 'persona_selected', { persona: persona.displayName });
            // Determine model to use - from payload, DB, or default
            let effectiveModel = model || process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
            if (conversationId) {
                try {
                    effectiveModel = await conversationService_1.conversationService.getCurrentModel(conversationId);
                    console.log(`📋 LOADED CONVERSATION MODEL from DB: ${effectiveModel} for conversation: ${conversationId}`);
                }
                catch (dbError) {
                    const errorMessage = dbError instanceof Error ? dbError.message : 'Unknown database error';
                    console.warn(`⚠️ FAILED TO LOAD CONVERSATION MODEL from DB, using payload/default: ${errorMessage}`);
                    effectiveModel = model || process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
                }
            }
            // Start typing indicator
            const typingPayload = {
                country_key: selected_country_key,
                timestamp: Date.now()
            };
            socket.emit('typing_start', typingPayload);
            // Prepare LLM messages
            const systemMessage = {
                role: 'system',
                content: persona.prompt_text // Remove restrictive safety constraints
            };
            const userMessage = {
                role: 'user',
                content: message
            };
            const messages = [systemMessage, userMessage];
            console.log(`🚀 CALLING LLM: ${messages.length} messages with model: ${effectiveModel}`);
            this.logResponseProcess(message_id, 'llm_call', { messageCount: messages.length, model: effectiveModel });
            // Stream LLM response
            const options = {
                model: effectiveModel,
                timeout: parseInt(process.env.REQUEST_TIMEOUT || '30000'), // 30 second default
                requestId: message_id
            };
            let fullResponse = '';
            let isFirstChunk = true;
            let retryCount = 0;
            const maxRetries = 2;
            let hasRetried = false; // Track if we've already retried to prevent duplicate calls
            try {
                for await (const chunk of this.llmAdapter.streamCompletion(messages, options)) {
                    if (chunk.isFinal) {
                        console.log(`✅ LLM RESPONSE COMPLETE: ${message_id} (${fullResponse.length} chars)`);
                        this.logResponseProcess(message_id, 'llm_complete', {
                            responseLength: fullResponse.length,
                            rawResponse: fullResponse
                        });
                        // Enhanced response validation and quality improvement
                        let finalResponse = fullResponse;
                        // Validate response quality
                        const validation = this.validateResponse(finalResponse);
                        this.logResponseProcess(message_id, 'validation', validation);
                        // If response is poor quality and we haven't exceeded retries, try again
                        if (!validation.isValid && retryCount < maxRetries && !hasRetried) {
                            console.warn(`⚠️ POOR RESPONSE QUALITY for ${message_id}, attempting retry ${retryCount + 1}`);
                            this.logResponseProcess(message_id, 'retry_attempt', {
                                attempt: retryCount + 1,
                                issues: validation.issues
                            });
                            retryCount++;
                            hasRetried = true; // Prevent multiple retries
                            // Retry with enhanced prompt using the same persona
                            const retryMessages = [
                                systemMessage, // This already contains the correct persona
                                userMessage,
                                {
                                    role: 'user',
                                    content: `Por favor, mejora esta respuesta usando el estilo y jerga del país seleccionado. Responde de manera natural y pregunta algo para continuar la conversación. Mensaje original: "${message}"`
                                }
                            ];
                            let retryResponse = '';
                            for await (const retryChunk of this.llmAdapter.streamCompletion(retryMessages, options)) {
                                if (retryChunk.isFinal) {
                                    retryResponse = retryChunk.deltaText || '';
                                    break;
                                }
                                if (retryChunk.deltaText) {
                                    retryResponse += retryChunk.deltaText;
                                }
                            }
                            if (retryResponse.trim().length > 0) {
                                finalResponse = retryResponse;
                                this.logResponseProcess(message_id, 'retry_success', { newResponseLength: finalResponse.length });
                            }
                        }
                        // Final validation and enhancement
                        const finalValidation = this.validateResponse(finalResponse);
                        // If still poor quality after retries, use fallback
                        if (!finalValidation.isValid || finalResponse.trim().length === 0) {
                            console.warn(`⚠️ RESPONSE STILL POOR QUALITY for ${message_id}, using fallback`);
                            this.logResponseProcess(message_id, 'fallback_used', {
                                reason: 'poor_quality_after_retries',
                                originalScore: validation.score,
                                finalScore: finalValidation.score
                            });
                            // Use persona-appropriate fallback
                            const fallbacks = {
                                mex: "¡Órale güey! Estoy aquí para platicar contigo. ¿Qué más quieres saber?",
                                arg: "¡Che! Estoy acá para charlar. ¿Qué te gustaría conversar?",
                                esp: "¡Oye! Estoy aquí para hablar contigo. ¿Qué te apetece comentar?",
                                dom: "¡Papá! Estoy aquí para conversar contigo. ¿Qué lo qué quieres platicar?"
                            };
                            finalResponse = fallbacks[selected_country_key] ||
                                "¡Hola! Estoy aquí para conversar. ¿Qué quieres platicar?";
                        }
                        // Add conversation context awareness
                        finalResponse = this.enhanceWithContextAwareness(finalResponse, message, selected_country_key);
                        // Send final message
                        const finalPayload = {
                            message_id,
                            final_content: finalResponse,
                            timestamp: Date.now()
                        };
                        socket.emit('assistant_final', finalPayload);
                        // Stop typing indicator
                        socket.emit('typing_end', typingPayload);
                        this.logResponseProcess(message_id, 'complete', {
                            finalLength: finalResponse.length,
                            qualityScore: finalValidation.score,
                            retriesUsed: retryCount
                        });
                        break;
                    }
                    if (chunk.deltaText) {
                        fullResponse += chunk.deltaText;
                        // Send delta
                        const deltaPayload = {
                            message_id,
                            chunk: chunk.deltaText,
                            is_final: false,
                            timestamp: Date.now()
                        };
                        socket.emit('assistant_delta', deltaPayload);
                        // Stop typing indicator after first chunk
                        if (isFirstChunk) {
                            console.log(`📝 STARTING STREAM: ${message_id}`);
                            this.logResponseProcess(message_id, 'streaming_start', { firstChunk: chunk.deltaText });
                            socket.emit('typing_end', typingPayload);
                            isFirstChunk = false;
                        }
                    }
                }
            }
            catch (error) {
                console.error(`❌ LLM STREAMING ERROR for ${message_id}:`, error);
                this.logResponseProcess(message_id, 'error', {
                    type: 'streaming_error',
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                // Stop typing indicator
                socket.emit('typing_end', typingPayload);
                // Provide fallback response instead of just error
                const fallbacks = {
                    mex: "¡Órale! Parece que tuve un problemita técnico. ¿Me puedes repetir eso o quieres platicar de otra cosa?",
                    arg: "¡Che! Tuve un problema técnico. ¿Me podés repetir eso o querés cambiar de tema?",
                    esp: "¡Oye! Tuve un problema técnico. ¿Me puedes repetir eso o quieres cambiar de tema?",
                    dom: "¡Papá! Tuve un problemita técnico. ¿Me puedes repetir eso o quieres platicar de otra cosa?"
                };
                const fallbackResponse = fallbacks[selected_country_key] ||
                    "¡Ey! Tuve un problema técnico. ¿Me puedes decir eso de nuevo o quieres cambiar de tema?";
                const fallbackPayload = {
                    message_id,
                    final_content: fallbackResponse,
                    timestamp: Date.now()
                };
                socket.emit('assistant_final', fallbackPayload);
                console.log(`📝 SENT FALLBACK RESPONSE for ${message_id} due to error`);
                this.logResponseProcess(message_id, 'fallback_sent', { reason: 'streaming_error' });
            }
        }
        catch (error) {
            console.error(`❌ CHAT SERVICE ERROR for ${message_id}:`, error);
            this.logResponseProcess(message_id, 'error', {
                type: 'service_error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            // Stop typing indicator if it's still running
            const typingPayload = {
                country_key: selected_country_key,
                timestamp: Date.now()
            };
            socket.emit('typing_end', typingPayload);
            // Provide fallback response for any service error
            const fallbacks = {
                mex: "¡Ey! Tuve un problema técnico. ¿Me puedes decir eso de nuevo o quieres cambiar de tema?",
                arg: "¡Che! Tuve un problema técnico. ¿Me podés decir eso de nuevo o querés cambiar de tema?",
                esp: "¡Oye! Tuve un problema técnico. ¿Me puedes decir eso de nuevo o quieres cambiar de tema?",
                dom: "¡Papá! Tuve un problema técnico. ¿Me puedes decir eso de nuevo o quieres cambiar de tema?"
            };
            const fallbackResponse = fallbacks[selected_country_key] ||
                "¡Ey! Tuve un problema técnico. ¿Me puedes decir eso de nuevo o quieres cambiar de tema?";
            const fallbackPayload = {
                message_id,
                final_content: fallbackResponse,
                timestamp: Date.now()
            };
            socket.emit('assistant_final', fallbackPayload);
            console.log(`📝 SENT FALLBACK RESPONSE for ${message_id} due to service error`);
            this.logResponseProcess(message_id, 'fallback_sent', { reason: 'service_error' });
        }
    }
    async cancelRequest(messageId) {
        await this.llmAdapter.cancel(messageId);
    }
    getPersonaList() {
        return personaService_1.personaService.getManifest();
    }
}
exports.ChatService = ChatService;
//# sourceMappingURL=chatService.js.map