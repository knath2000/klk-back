import { personaService } from './personaService';
import { LangDBAdapter } from './langdbAdapter';
import { ILLMAdapter } from './llmAdapter';
import {
  Persona,
  Message,
  LLMMessage,
  UserMessagePayload,
  AssistantDeltaPayload,
  AssistantFinalPayload,
  TypingPayload
} from '../types';
import { Server, Socket } from 'socket.io';

export class ChatService {
  private llmAdapter: ILLMAdapter;
  private activeStreams: Map<string, AbortController> = new Map();

  constructor(llmAdapter: ILLMAdapter) {
    this.llmAdapter = llmAdapter;
  }

  async handleUserMessage(
    socket: Socket,
    payload: UserMessagePayload
  ): Promise<void> {
    const { message, selected_country_key, client_ts, message_id } = payload;

    try {
      // Validate country key
      if (!personaService.isValidCountryKey(selected_country_key)) {
        socket.emit('error', {
          message: 'Invalid country selection',
          code: 'INVALID_COUNTRY'
        });
        return;
      }

      // Get persona
      const persona = personaService.getPersona(selected_country_key);
      if (!persona) {
        socket.emit('error', {
          message: 'Persona not found',
          code: 'PERSONA_NOT_FOUND'
        });
        return;
      }

      // Start typing indicator
      const typingPayload: TypingPayload = {
        country_key: selected_country_key,
        timestamp: Date.now()
      };
      socket.emit('typing_start', typingPayload);

      // Prepare LLM messages
      const systemMessage: LLMMessage = {
        role: 'system',
        content: persona.prompt_text + '\n\nSafety: Avoid political content, profanity, insults.'
      };

      const userMessage: LLMMessage = {
        role: 'user',
        content: message
      };

      const messages: LLMMessage[] = [systemMessage, userMessage];

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
            const finalPayload: AssistantFinalPayload = {
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
            const deltaPayload: AssistantDeltaPayload = {
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
      } catch (error) {
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
    } catch (error) {
      console.error('Chat service error:', error);
      socket.emit('error', {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  async cancelRequest(messageId: string): Promise<void> {
    await this.llmAdapter.cancel(messageId);
  }

  getPersonaList(): Persona[] {
    return personaService.getManifest();
  }
}