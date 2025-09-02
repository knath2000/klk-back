"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const personaService_1 = require("./personaService");
class ChatService {
    constructor(llmAdapter) {
        this.activeStreams = new Map();
        this.llmAdapter = llmAdapter;
    }
    async handleUserMessage(socket, payload) {
        const { message, selected_country_key, client_ts, message_id } = payload;
        try {
            // Validate country key
            if (!personaService_1.personaService.isValidCountryKey(selected_country_key)) {
                socket.emit('error', {
                    message: 'Invalid country selection',
                    code: 'INVALID_COUNTRY'
                });
                return;
            }
            // Get persona
            const persona = personaService_1.personaService.getPersona(selected_country_key);
            if (!persona) {
                socket.emit('error', {
                    message: 'Persona not found',
                    code: 'PERSONA_NOT_FOUND'
                });
                return;
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
                content: persona.prompt_text + '\n\nSafety: Avoid political content, profanity, insults.'
            };
            const userMessage = {
                role: 'user',
                content: message
            };
            const messages = [systemMessage, userMessage];
            // Stream LLM response
            const options = {
                model: process.env.LANGDB_MODEL || 'gemini-2.5-flash-lite',
                timeout: parseInt(process.env.REQUEST_TIMEOUT || '30000'),
                requestId: message_id
            };
            let fullResponse = '';
            let isFirstChunk = true;
            try {
                for await (const chunk of this.llmAdapter.streamCompletion(messages, options)) {
                    if (chunk.isFinal) {
                        // Send final message
                        const finalPayload = {
                            message_id,
                            final_content: fullResponse,
                            timestamp: Date.now()
                        };
                        socket.emit('assistant_final', finalPayload);
                        // Stop typing indicator
                        socket.emit('typing_end', typingPayload);
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
                            socket.emit('typing_end', typingPayload);
                            isFirstChunk = false;
                        }
                    }
                }
            }
            catch (error) {
                console.error('Streaming error:', error);
                // Stop typing indicator
                socket.emit('typing_end', typingPayload);
                // Send error to client
                socket.emit('error', {
                    message: 'Failed to generate response',
                    code: 'LLM_ERROR',
                    details: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
        catch (error) {
            console.error('Chat service error:', error);
            socket.emit('error', {
                message: 'Internal server error',
                code: 'INTERNAL_ERROR'
            });
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