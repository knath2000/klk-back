import {
  Server,
  Socket,
} from 'socket.io';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { conversationService } from './conversationService';
import { personaService } from './personaService';
import { collaborationService } from './collaborationService';
import { translationService } from './translationService';
import { OpenRouterAdapter } from './openrouterAdapter';
import { LLMMessage, LLMOptions, DeltaChunk, UserMessagePayload } from '../types';

interface WebSocketUser {
  userId: string;
  socket: Socket;
  rooms: Set<string>; // conversation IDs
}

// Define local DeltaChunk type for Promise typing
interface LocalDeltaChunk {
  deltaText?: string;
  isFinal: boolean;
  meta?: any;
}

class WebSocketService {
  private io: Server;
  private users: Map<string, WebSocketUser> = new Map();
  private conversationRooms: Map<string, Set<string>> = new Map(); // conversationId -> Set of userIds
  private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();
  private guestRateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();
  private socketActivity: Map<string, number> = new Map(); // socketId -> lastActivity
  private idleTimeoutCleanup: NodeJS.Timeout | null = null;
  private metrics = {
    requests: { count: 0, inc: () => this.metrics.requests.count++ },
    successes: { count: 0, inc: () => this.metrics.successes.count++ },
    errors: { count: 0, inc: () => this.metrics.errors.count++ }
  };

  // Neon/Stack Auth config for Socket.IO auth
  private static STACK_PROJECT_ID =
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID || process.env.STACK_PROJECT_ID || '';
  private static EXPECTED_ISSUER = WebSocketService.STACK_PROJECT_ID
    ? `https://api.stack-auth.com/api/v1/projects/${WebSocketService.STACK_PROJECT_ID}`
    : undefined;
  private static JWKS = WebSocketService.STACK_PROJECT_ID
    ? createRemoteJWKSet(
        new URL(
          `https://api.stack-auth.com/api/v1/projects/${WebSocketService.STACK_PROJECT_ID}/.well-known/jwks.json`
        )
      )
    : undefined;
  private static EXPECTED_AUD = process.env.STACK_EXPECTED_AUD; // optional
  private static REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';
  private static ALLOW_GUEST_TRANSLATION = process.env.ALLOW_GUEST_TRANSLATION !== 'false';
  
  constructor(io: Server) {
    this.io = io;
    // Socket.IO auth middleware (JWT via Neon/Stack Auth). Optional gating with REQUIRE_AUTH.
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake?.auth?.token as string | undefined;
        console.log('🔐 [WebSocket Auth] Received handshake auth:', {
          hasToken: !!token,
          tokenLength: token?.length,
          tokenPrefix: token?.substring(0, 20) + '...',
          handshakeKeys: Object.keys(socket.handshake),
          authKeys: socket.handshake?.auth ? Object.keys(socket.handshake.auth) : []
        });

        // Additional token format analysis
        if (token) {
          console.log('🔐 [WebSocket Auth] Token format analysis:', {
            startsWithEyJ: token.startsWith('eyJ'),
            containsDots: token.includes('.'),
            dotCount: token.split('.').length,
            totalLength: token.length,
            firstChars: token.substring(0, 10),
            lastChars: token.substring(token.length - 10)
          });
        }

        if (!token) {
          if (WebSocketService.REQUIRE_AUTH && !WebSocketService.ALLOW_GUEST_TRANSLATION) {
            console.log('🔐 [WebSocket Auth] No token provided, REQUIRE_AUTH=true, ALLOW_GUEST_TRANSLATION=false, rejecting');
            return next(new Error('Token required'));
          } else {
            console.log('🔐 [WebSocket Auth] No token provided, allowing anonymous (REQUIRE_AUTH=false or ALLOW_GUEST_TRANSLATION=true)');
            return next();
          }
        }
        if (!WebSocketService.JWKS || !WebSocketService.EXPECTED_ISSUER) {
          if (WebSocketService.REQUIRE_AUTH) {
            console.log('🔐 [WebSocket Auth] Auth not configured, REQUIRE_AUTH=true, rejecting');
            return next(new Error('Auth not configured'));
          } else {
            console.log('🔐 [WebSocket Auth] Auth not configured, REQUIRE_AUTH=false, allowing anonymous');
            return next();
          }
        }
        console.log('🔐 [WebSocket Auth] Attempting JWT verification...');
        const { payload } = await jwtVerify(token, WebSocketService.JWKS, {
          issuer: WebSocketService.EXPECTED_ISSUER,
          audience: WebSocketService.EXPECTED_AUD
        });
        console.log('🔐 [WebSocket Auth] JWT verification successful, payload sub:', payload.sub);
        (socket as any).user = {
          sub: payload.sub,
          email: (payload as any).email,
          name: (payload as any).name,
          claims: payload
        };
        console.log('🔐 [WebSocket Auth] User attached to socket:', (socket as any).user.sub);
        return next();
      } catch (err: any) {
        console.error('🔐 [WebSocket Auth] Authentication failed:', err.message);
        if (WebSocketService.REQUIRE_AUTH) {
          console.log('🔐 [WebSocket Auth] REQUIRE_AUTH=true, rejecting due to auth failure');
          return next(new Error('Invalid token'));
        }
        console.log('🔐 [WebSocket Auth] REQUIRE_AUTH=false, allowing anonymous despite auth failure');
        // Soft-fail if not enforced
        return next();
      }
    });
    this.setupWebSocketHandlers();
    this.startIdleTimeoutCleanup();
  }

  private startIdleTimeoutCleanup() {
    // Clean up idle connections every 5 minutes
    this.idleTimeoutCleanup = setInterval(() => {
      this.cleanupIdleConnections();
    }, 5 * 60 * 1000); // 5 minutes
  }

  private cleanupIdleConnections() {
    const now = Date.now();
    const idleTimeout = 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;

    for (const [socketId, lastActivity] of this.socketActivity.entries()) {
      if (now - lastActivity > idleTimeout) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          console.log('🧹 Cleaning up idle connection:', socketId, 'last activity:', new Date(lastActivity).toISOString());
          socket.disconnect(true);
          cleanedCount++;
        }
        this.socketActivity.delete(socketId);
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} idle connections`);
    }
  }

  private updateActivity(socketId: string) {
    this.socketActivity.set(socketId, Date.now());
  }

  private setupWebSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      // Initialize activity tracking
      this.updateActivity(socket.id);

      // Check for session ID in query parameters for reconnection
      const sessionId = socket.handshake.query.sessionId as string;
      if (sessionId) {
        console.log('🔄 Session ID detected:', sessionId, 'for socket:', socket.id);
        // Store session mapping for potential state restoration
        (socket as any).sessionId = sessionId;
      }

      // Add catch-all event handler for debugging unhandled events
      socket.onAny((event, ...args) => {
        if (!['connect', 'disconnect', 'ping', 'pong', 'translation_request', 'user_message', 'load_history'].includes(event)) {
          console.log('🔍 UNHANDLED EVENT:', event, 'from', socket.id, 'args:', args.length > 0 ? JSON.stringify(args[0]).substring(0, 200) : 'no args');
        }
      });

      // Add error handling for reconnects
      socket.on('connect_error', (err) => {
        console.error('Socket.IO connect error:', err.message);
        // Emit to client for retry
        socket.emit('reconnect_attempt', { delay: 1000 });
      });

      // Enhanced reconnect event handler
      socket.on('reconnect', () => {
        console.log('🔄 Client reconnected:', socket.id);

        // Check if we have a session ID for state restoration
        const sessionId = (socket as any).sessionId;
        if (sessionId) {
          console.log('🔄 Attempting to restore session state for:', sessionId);

          // Look for existing user data that might be stored
          // In a production system, this would come from a database/cache
          // For now, we'll emit a session restoration event
          socket.emit('session_restored', {
            sessionId,
            timestamp: new Date().toISOString()
          });
        }

        // Notify client of successful reconnection
        socket.emit('reconnected', {
          timestamp: new Date().toISOString(),
          sessionRestored: !!sessionId
        });
      });

      // Enhanced translation request handling with rate limiting and metrics
      socket.on('translation_request', async (data: { query: string; language: string; context?: string; timestamp: number }) => {
        // Update activity timestamp
        this.updateActivity(socket.id);

        console.log('📨 Received translation_request:', { ...data, id: socket.id });
        const transport = socket.conn?.transport?.name || 'unknown';
        console.log('Transport for translation_request:', transport);

        // Rate limiting: Different limits for authenticated vs guest users
        const now = Date.now();
        const userId = (socket as any).user?.sub;
        const isAuthenticated = !!userId;
        const userKey = isAuthenticated ? userId : socket.id; // Use userId for auth, socketId for guests
        const rateLimitMap = isAuthenticated ? this.rateLimitMap : this.guestRateLimitMap;
        const maxRequests = isAuthenticated ? 10 : 3; // Lower limit for guests

        const rateLimitData = rateLimitMap.get(userKey);
        if (!rateLimitData) {
          rateLimitMap.set(userKey, { count: 0, resetTime: now + 60000 }); // 1 min window
        }
        const currentLimit = rateLimitMap.get(userKey)!;
        if (currentLimit.count >= maxRequests) {
          const message = isAuthenticated
            ? 'Rate limit exceeded. Please wait.'
            : 'Guest rate limit exceeded. Please sign in for higher limits or wait.';
          socket.emit('translation_error', { message });
          return;
        }
        currentLimit.count++;

        // Metrics: Increment request counter
        this.metrics.requests.inc();

        try {
          // Validate connection state FIRST
          if (!socket.connected) {
            console.error('❌ Translation request from disconnected socket:', socket.id);
            socket.emit('translation_error', { message: 'Connection lost; please retry' });
            return;
          }

          if (!data.query) {
            socket.emit('translation_error', { message: 'Query is required' });
            return;
          }

          // Call translation service with error handling
           let result;
           try {
             const authedUserId = (socket as any).user?.sub || socket.id;
             
             // Retry function with exponential backoff
             const attempt = async (tries = 0) => {
               try {
                 return await translationService.translate({
                   text: data.query,
                   sourceLang: data.language || 'en',
                   targetLang: 'es',
                   context: data.context,
                   userId: authedUserId
                 });
               } catch (err) {
                 if (tries < 2) {
                   const delay = Math.min(500 * 2 ** tries, 2000);
                   console.log(`🔁 Retry translation (${tries + 1}) in ${delay}ms`);
                   await new Promise((r) => setTimeout(r, delay));
                   return attempt(tries + 1);
                 }
                 console.error('❌ Translation failed after retries', err);
                 socket.emit('translation_fallback', { transport, reason: String((err as Error)?.message || err) });
                 throw err;
               }
             };
             
             result = await attempt();
             console.log('✅ Translation service returned result for:', data.query, 'keys:', Object.keys(result));
           } catch (translationError: any) {
             console.error('❌ Translation service error for', data.query, ':', (translationError as Error).message);
             socket.emit('translation_error', { message: (translationError as Error).message || 'Translation failed' });
             return;
           }

          // Transform result to match frontend TranslationResult interface
          const frontendResult = {
            id: `translation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            query: data.query,
            definitions: result.definitions,
            examples: result.examples,
            conjugations: result.conjugations,
            audio: result.audio,
            related: result.related,
            // New: include SpanishDict-style entry for richer UI
            entry: (result as any).entry,
            timestamp: Date.now()
          };

          console.log('🔄 Data transformation complete:', {
            originalKeys: Object.keys(result),
            frontendKeys: Object.keys(frontendResult),
            definitionsCount: result.definitions?.length || 0,
            examplesCount: result.examples?.length || 0
          });

          // Stream response (delta for partial, final for complete)
          if (transport === 'websocket') {
            // Stream deltas if websocket (implement true streaming with chunks)
            const firstPreview =
              (result.definitions?.[0]?.text) ||
              (result.definitions?.[0]?.meaning) ||
              ((result as any).entry?.senses?.[0]?.gloss) ||
              'Translation completed';
            const chunks = String(firstPreview).split(' '); // Simple word-based streaming
            chunks.forEach((chunk: string, index: number) => {
              setTimeout(() => {
                socket.emit('translation_delta', { chunk, index, total: chunks.length, id: frontendResult.id });
              }, index * 100); // 100ms delay per chunk
            });
            setTimeout(() => {
              console.log('📤 Emitting translation_final for:', frontendResult.id, 'to socket:', socket.id);
              socket.emit('translation_final', frontendResult);
            }, chunks.length * 100 + 500);
          } else {
            // Polling-friendly: Send full result
            console.log('📤 Emitting translation_final for:', frontendResult.id, 'to socket:', socket.id, '(polling transport)');
            socket.emit('translation_final', frontendResult);
          }

          // Metrics: Increment success counter
          this.metrics.successes.inc();
          console.log('Translation completed for query:', data.query);
        } catch (error: any) {
          console.error('Translation processing error:', error);
          // Metrics: Increment error counter
          this.metrics.errors.inc();
          socket.emit('translation_error', { message: error.message || 'Translation failed' });
        }
      });

      // Updated user_message handler with optional auth for non-logged-in users
      socket.on('user_message', async (data: UserMessagePayload) => {
        const startTime = Date.now();
        console.log(`[DEBUG] user_message handler started at ${new Date(startTime).toISOString()}`);

        // Update activity timestamp
        this.updateActivity(socket.id);

        console.log('📨 Received user_message:', { ...data, id: socket.id });
        const transport = socket.conn?.transport?.name || 'unknown';
        console.log('Transport for user_message:', transport);

        // Rate limiting (reuse existing logic)
        const now = Date.now();
        const userKey = socket.id;
        const rateLimitData = this.rateLimitMap.get(userKey);
        if (!rateLimitData) {
          this.rateLimitMap.set(userKey, { count: 0, resetTime: now + 60000 });
        }
        const currentLimit = this.rateLimitMap.get(userKey)!;
        if (currentLimit.count >= 5) { // 5 messages per minute for chat
          console.log('[DEBUG] Rate limit exceeded');
          socket.emit('error', { message: 'Rate limit exceeded. Please wait.' });
          return;
        }
        currentLimit.count++;

        // Metrics
        this.metrics.requests.inc();

        try {
          console.log('[DEBUG] Starting validation checks');

          if (!data.message.trim()) {
            console.log('[DEBUG] Validation failed: empty message');
            socket.emit('error', { message: 'Message cannot be empty' });
            return;
          }

          if (!data.selected_country_key) {
            console.log('[DEBUG] Validation failed: no country selected');
            socket.emit('error', { message: 'Please select a country first' });
            return;
          }

          // Validate connection
          if (!socket.connected) {
            console.warn('[DEBUG] Validation failed: socket not connected');
            socket.emit('error', { message: 'Connection lost; please retry' });
            return;
          }

          console.log('[DEBUG] Validation checks passed');

          // Extract authenticated user ID from Neon Stack Auth (optional for unauth)
          const userId = (socket as any).user?.sub;
          console.log('[DEBUG] Extracted userId:', userId ? `${userId.slice(0, 8)}...` : 'none (anonymous)');
          console.log('[DEBUG] Socket user object:', (socket as any).user);
          const isAuthenticated = !!userId;

          let conversationId = data.conversationId;
          let isNewConversation = false;
          let tempConversationId = null;
          // A handler-scoped resolved ID to use after auth checks/creation
          let resolvedConversationId: string | undefined;

          if (isAuthenticated) {
            // For authenticated users, use persistent conversation
            if (!conversationId) {
              console.log('[DEBUG] No conversationId, creating new one for authenticated user');
              const newConv = await conversationService.createConversation({
                user_id: userId,
                title: data.message.substring(0, 50) + '...', // Initial title from first message
                model: data.model || process.env.OPENROUTER_MODEL || 'gpt-4o-mini',
                persona_id: data.selected_country_key,
                email: (socket as any).user?.email,
                name: (socket as any).user?.name
              });
              conversationId = newConv.id;
              isNewConversation = true;
              console.log(`🆕 Created new conversation ${conversationId} for user ${userId}`);
            } else {
              console.log('[DEBUG] Using existing conversationId:', conversationId);
            }

            // Verify user access to conversation; create if missing or stale/inaccessible id (stale localStorage)
            console.log('[DEBUG] Verifying user access to conversation');
            let conversation = conversationId ? await conversationService.getConversation(conversationId) : null;
            let hasAccess = false;
            if (conversationId && conversation) {
              hasAccess = await collaborationService.hasAccessToConversation(conversationId, userId);
            }
            if (!conversationId || !conversation) {
              console.log('[DEBUG] Conversation not found; creating new for authenticated user');
              const newConv = await conversationService.createConversation({
                user_id: userId,
                title: data.message.substring(0, 50) + '...',
                model: data.model || process.env.OPENROUTER_MODEL || 'gpt-4o-mini',
                persona_id: data.selected_country_key,
                email: (socket as any).user?.email,
                name: (socket as any).user?.name
              });
              conversationId = newConv.id;
              isNewConversation = true;
              conversation = newConv as any;
              console.log(`🆕 Created new conversation ${conversationId} for user ${userId} (replacement for missing/invalid id)`);
            } else if (!hasAccess && conversation.user_id !== userId) {
              console.log('[DEBUG] Access denied to existing conversation; creating fresh conversation for user');
              const newConv = await conversationService.createConversation({
                user_id: userId,
                title: data.message.substring(0, 50) + '...',
                model: data.model || process.env.OPENROUTER_MODEL || 'gpt-4o-mini',
                persona_id: data.selected_country_key,
                email: (socket as any).user?.email,
                name: (socket as any).user?.name
              });
              conversationId = newConv.id;
              isNewConversation = true;
              conversation = newConv as any;
              console.log(`🆕 Created new conversation ${conversationId} for user ${userId} (no access to provided id)`);
            }
            console.log('[DEBUG] User access verified or new conversation established');

            // Resolve a definite conversation id for typed usage
            if (!conversationId) {
              console.error('[DEBUG] Conversation ID unresolved after creation/access check');
              socket.emit('error', { message: 'Failed to resolve conversation' });
              return;
            }
            resolvedConversationId = conversationId as string;

            // Store user message
            console.log('[DEBUG] Storing user message');
            const userMessageId = data.message_id || this.generateMessageId();
            await conversationService.addMessage({
              conversation_id: resolvedConversationId,
              role: 'user',
              content: data.message,
              model: data.model || '',
              persona_id: data.selected_country_key,
              tokens_used: undefined
            });
            console.log(`💾 Stored user message ${userMessageId} in conversation ${resolvedConversationId}`);

            // Emit user message confirmation to client
            socket.emit('user_message_stored', { message_id: userMessageId, conversationId: resolvedConversationId });
          } else {
            // For unauthenticated users, use temporary conversation ID, skip DB
            console.log('[DEBUG] Unauthenticated user, using temporary conversation');
            if (!conversationId) {
              tempConversationId = `temp-conv-${socket.id}-${Date.now()}`;
              conversationId = tempConversationId;
              isNewConversation = true;
              console.log(`🆕 Created temporary conversation ${conversationId} for anonymous user`);
            }
            // No DB storage for unauth
          }

          console.log('[DEBUG] Conversation ID resolved:', conversationId);

          // Fetch persona (common for both auth/unauth)
          console.log('[DEBUG] Fetching persona');
          const persona = await personaService.getPersona(data.selected_country_key);
          if (!persona) {
            console.error('[DEBUG] No persona found');
            socket.emit('error', { message: 'Invalid country selection' });
            return;
          }
          console.log('[DEBUG] Persona fetched successfully');

          // Prepare LLM messages (include conversation history for context if authenticated)
          let messages: LLMMessage[];
          if (isAuthenticated) {
            console.log('[DEBUG] Fetching conversation history');
            const history = await conversationService.getConversationMessages(resolvedConversationId as string);
            console.log(`[DEBUG] Fetched ${history.length} history messages`);
            messages = [
              { role: 'system', content: persona.prompt_text },
              ...history.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })).slice(-10), // Last 10 messages for context
              { role: 'user', content: data.message }
            ];
          } else {
            // For unauth, no history, just system + current message
            messages = [
              { role: 'system', content: persona.prompt_text },
              { role: 'user', content: data.message }
            ];
            console.log('[DEBUG] Unauthenticated, no history included in LLM request');
          }

          console.log('[DEBUG] LLM messages prepared, length:', messages.length);

          // Log before OpenRouter call
          console.log('[OpenRouter] Preparing to call streamCompletion');
          console.log('[OpenRouter] API key present:', !!process.env.OPENROUTER_API_KEY ? `${process.env.OPENROUTER_API_KEY?.slice(0, 10)}...` : 'NO KEY');

          // Determine effective model with strict precedence
          let effectiveModel: string | undefined;
          if (data.model) {
            effectiveModel = data.model;
            console.log(`🧠 Using payload-selected model for request ${data.message_id}: ${effectiveModel}`);
          } else if (isAuthenticated && conversationId) {
            try {
              const dbModel = await conversationService.getCurrentModel(conversationId);
              if (dbModel) {
                effectiveModel = dbModel;
                console.log(`📋 LOADED CONVERSATION MODEL from DB for ${conversationId}: ${effectiveModel}`);
              }
            } catch (dbError: any) {
              console.warn(`⚠️ FAILED TO LOAD CONVERSATION MODEL from DB, will use default: ${dbError?.message || dbError}`);
            }
          }
          if (!effectiveModel) {
            effectiveModel = process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
            console.log(`🔁 Fallback to default model for request ${data.message_id}: ${effectiveModel}`);
          }

          console.log('[OpenRouter] Model:', effectiveModel, 'Messages length:', messages.length);

          // Check for API key before proceeding
          if (!process.env.OPENROUTER_API_KEY) {
            const errorMsg = 'OpenRouter API key not configured';
            console.error(`[OpenRouter] ${errorMsg}`);
            socket.emit('llm_error', { message: errorMsg });
            return;
          }

          const openRouterAdapter = new OpenRouterAdapter(
            process.env.OPENROUTER_API_KEY || '',
            process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
          );

          const options: LLMOptions = {
            model: effectiveModel,
            timeout: 30000,
            requestId: data.message_id
          };

          // Stream response with timeout wrapper
          const streamPromise = (async () => {
            const stream = openRouterAdapter.streamCompletion(messages, options);
            let fullContent = '';
            const assistantMessageId = this.generateMessageId();

            // Timeout for no chunks after 30s
            const timeoutPromise = new Promise<DeltaChunk>((_, reject) => {
              setTimeout(() => reject(new Error('No response chunks received within 30s')), 30000);
            });

            try {
              for await (const chunk of stream) {
                if (chunk.deltaText) {
                  fullContent += chunk.deltaText;
                  socket.emit('assistant_delta', {
                    message_id: assistantMessageId,
                    chunk: chunk.deltaText,
                    index: fullContent.length,
                    total: null // Unknown total for streaming
                  });
                }
              }
              return { fullContent, assistantMessageId };
            } catch (streamError) {
              console.error('[OpenRouter] Stream error:', streamError);
              socket.emit('llm_error', { message: 'LLM stream failed: ' + (streamError as Error).message });
              throw streamError;
            }
          })();

          const { fullContent, assistantMessageId } = await Promise.race([
            streamPromise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Stream timeout')), 60000)) // Overall 60s timeout
          ]);

          console.log('[DEBUG] OpenRouter call completed');

          // Log after OpenRouter call
          console.log('[OpenRouter] streamCompletion completed, full content length:', fullContent.length);

          // Store assistant message if authenticated
          if (isAuthenticated) {
            await conversationService.addMessage({
              conversation_id: resolvedConversationId as string,
              role: 'assistant',
              content: fullContent,
              model: effectiveModel,
              persona_id: data.selected_country_key,
              tokens_used: undefined
            });
            console.log(`💾 Stored assistant message ${assistantMessageId} in conversation ${resolvedConversationId}`);
          } else {
            console.log('[DEBUG] Unauthenticated, skipping assistant message storage');
          }

          // Emit final message
          socket.emit('assistant_final', {
            message_id: assistantMessageId,
            final_content: fullContent,
            timestamp: new Date().toISOString(),
            conversationId
          });

          // If new conversation, emit the created conversation ID back to client (only for auth, temp for unauth)
          if (isNewConversation) {
            socket.emit('conversation_created', { conversationId, userId: isAuthenticated ? userId : 'anonymous' });
          }

          console.log(`[DEBUG] Handler completed at ${new Date().toISOString()}, total time: ${Date.now() - startTime}ms`);

          // Metrics
          this.metrics.successes.inc();
          console.log('✅ User message processed for:', data.message_id, 'content length:', fullContent.length);
        } catch (error: any) {
          const endTime = Date.now();
          console.error(`[DEBUG] Handler error at ${new Date(endTime).toISOString()}, total time: ${endTime - startTime}ms`);
          console.error('❌ User message processing error:', error);
          this.metrics.errors.inc();
          socket.emit('error', {
            message: 'Sorry, I encountered an error processing your message. Please try again.',
            details: error.message
          });
        }
      });

      // Load conversation history
      socket.on('load_history', async (data: { conversationId: string }) => {
        const { conversationId } = data;
        const userId = (socket as any).user?.sub;

        if (!userId) {
          socket.emit('error', { message: 'Authentication required to load history' });
          return;
        }

        try {
          // Check if conversation exists and user has access
          const conversation = await conversationService.getConversation(conversationId);
            
          if (conversation) {
            // Conversation exists - verify user access
            const hasAccess = await collaborationService.hasAccessToConversation(conversationId, userId);
            if (!hasAccess && conversation.user_id !== userId) {
              // Treat as stale/foreign id: return empty history without error to avoid UX regressions
              socket.emit('history_loaded', {
                conversationId,
                messages: [],
                timestamp: new Date().toISOString()
              });
              console.log(`📚 Access denied to ${conversationId} for user ${userId} - returning empty history`);
              return;
            }

            // Fetch and return messages
            const messages = await conversationService.getConversationMessages(conversationId);
            socket.emit('history_loaded', {
              conversationId,
              messages: messages.slice(-50).map(msg => ({
                id: msg.id,
                type: msg.role as 'user' | 'assistant',
                content: msg.content,
                timestamp: new Date(msg.created_at).getTime(), // Convert Date to number
                country_key: msg.persona_id || undefined
              })),
              timestamp: new Date().toISOString()
            });
            console.log(`📚 Loaded ${messages.length} messages for user ${userId} in conversation ${conversationId}`);
          } else {
            // Conversation doesn't exist - return empty history (normal for new users)
            socket.emit('history_loaded', {
              conversationId,
              messages: [],
              timestamp: new Date().toISOString()
            });
            console.log(`📚 Conversation ${conversationId} not found for user ${userId} - returning empty history`);
          }
        } catch (error: any) {
          console.error('Error loading history:', error);
          socket.emit('error', { message: 'Failed to load conversation history' });
        }
      });

      // Create conversation handler
      socket.on('create_conversation', async (data: { title?: string; persona_id?: string }) => {
        const userId = (socket as any).user?.sub;
        if (!userId) {
          console.log('❌ Create conversation: Authentication required');
          socket.emit('error', { message: 'Authentication required to create conversation' });
          return;
        }

        try {
          const newConv = await conversationService.createConversation({
            user_id: userId,
            title: data.title || 'New Chat',
            model: process.env.OPENROUTER_MODEL || 'gpt-4o-mini',
            persona_id: data.persona_id || undefined,
            email: (socket as any).user?.email,
            name: (socket as any).user?.name
          });
          console.log(`🆕 Created new conversation ${newConv.id} for user ${userId}`);
          socket.emit('conversation_created', { conversationId: newConv.id, userId });
        } catch (error: any) {
          console.error('Error creating conversation:', error);
          socket.emit('error', { message: 'Failed to create conversation' });
        }
      });

      // Add general error handler for connection issues
      this.io.engine.on('connection_error', (err) => {
        console.error('Socket.IO engine connection error:', err.req?.url, err.type, err.message);
      });

      // User authentication
      socket.on('authenticate', (userId: string) => {
        const authedUserId = (socket as any).user?.sub || userId;
        this.users.set(socket.id, {
          userId: authedUserId,
          socket,
          rooms: new Set()
        });
        console.log('User authenticated:', authedUserId);
      });

      // Join conversation room
      socket.on('join_conversation', async (data: { conversationId: string; userId: string }) => {
        const { conversationId } = data;
        const userId = (socket as any).user?.sub || data.userId;
        
        try {
          // Check if user has access to conversation
          const hasAccess = await collaborationService.hasAccessToConversation(conversationId, userId);
          const conversation = await conversationService.getConversation(conversationId);
          
          if (!hasAccess && (!conversation || conversation.user_id !== userId)) {
            socket.emit('error', { message: 'Access denied to conversation' });
            return;
          }

          // Join the room
          socket.join(conversationId);
          
          // Track user in conversation room
          if (!this.conversationRooms.has(conversationId)) {
            this.conversationRooms.set(conversationId, new Set());
          }
          this.conversationRooms.get(conversationId)?.add(userId);
          
          // Track user's rooms
          const user = this.users.get(socket.id);
          if (user) {
            user.rooms.add(conversationId);
          }

          // Notify other users in the room
          socket.to(conversationId).emit('user_joined', {
            userId,
            conversationId,
            timestamp: new Date().toISOString()
          });

          console.log(`User ${userId} joined conversation ${conversationId}`);
        } catch (error) {
          console.error('Error joining conversation:', error);
          socket.emit('error', { message: 'Failed to join conversation' });
        }
      });

      // Leave conversation room
      socket.on('leave_conversation', (data: { conversationId: string; userId: string }) => {
        const { conversationId } = data;
        const userId = (socket as any).user?.sub || data.userId;
        
        socket.leave(conversationId);
        
        // Remove user from conversation room tracking
        const room = this.conversationRooms.get(conversationId);
        if (room) {
          room.delete(userId);
        }
        
        // Remove from user's rooms
        const user = this.users.get(socket.id);
        if (user) {
          user.rooms.delete(conversationId);
        }

        // Notify other users in the room
        socket.to(conversationId).emit('user_left', {
          userId,
          conversationId,
          timestamp: new Date().toISOString()
        });

        console.log(`User ${userId} left conversation ${conversationId}`);
      });

      // Send message to conversation
      socket.on('send_message', async (data: { 
        conversationId: string; 
        userId: string; 
        content: string; 
        role: 'user' | 'assistant';
        messageId?: string;
      }) => {
        const { conversationId, content, role, messageId } = data;
        const userId = (socket as any).user?.sub || data.userId;
        
        try {
          // Check if user has access to conversation
          const hasAccess = await collaborationService.hasAccessToConversation(conversationId, userId);
          const conversation = await conversationService.getConversation(conversationId);
          
          if (!hasAccess && (!conversation || conversation.user_id !== userId)) {
            socket.emit('error', { message: 'Access denied to conversation' });
            return;
          }

          // Add message to conversation
          const messageData = {
            conversation_id: conversationId,
            role,
            content,
            model: conversation?.model || 'gpt-4o-mini',
            user_id: userId
          };

          const message = await conversationService.addMessage(messageData as any);

          // Broadcast message to all users in the conversation room
          this.io.to(conversationId).emit('message_received', {
            messageId: messageId || message.id,
            conversationId,
            userId,
            content,
            role,
            timestamp: new Date().toISOString()
          });

          console.log(`Message sent to conversation ${conversationId}`);
        } catch (error) {
          console.error('Error sending message:', error);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Typing indicator
      socket.on('typing', (data: { conversationId: string; userId: string; isTyping: boolean }) => {
        const { conversationId, isTyping } = data;
        const userId = (socket as any).user?.sub || data.userId;
        
        // Broadcast typing status to all users in the conversation room
        socket.to(conversationId).emit('user_typing', {
          userId,
          conversationId,
          isTyping,
          timestamp: new Date().toISOString()
        });
      });

      // Conversation shared
      socket.on('conversation_shared', (data: { conversationId: string; sharedWith: string; permission: string; userId: string }) => {
        const { conversationId, sharedWith, permission } = data;
        const userId = (socket as any).user?.sub || data.userId;
        
        // Notify the user who was shared with (if they're online)
        this.sendToUser(sharedWith, 'conversation_shared_with_you', {
          conversationId,
          sharedBy: userId,
          permission,
          timestamp: new Date().toISOString()
        });
      });

      // Handle disconnection with enhanced logging
      socket.on('disconnect', (reason) => {
        const transport = socket.conn?.transport?.name || 'unknown';
        const sessionId = (socket as any).sessionId;

        // Enhanced disconnect logging with reason categorization
        let disconnectCategory = 'unknown';
        if (reason === 'io client disconnect' as any) {
          disconnectCategory = 'client_initiated';
        } else if (reason === 'transport close' as any) {
          disconnectCategory = 'transport_closed';
        } else if (reason === 'ping timeout' as any) {
          disconnectCategory = 'ping_timeout';
        } else if (reason === 'transport error' as any) {
          disconnectCategory = 'transport_error';
        } else {
          disconnectCategory = reason;
        }

        console.log('🔌 WebSocket DISCONNECTED:', {
          socketId: socket.id,
          reason,
          category: disconnectCategory,
          transport,
          sessionId,
          timestamp: new Date().toISOString()
        });

        const user = this.users.get(socket.id);
        if (user) {
          // Leave all rooms
          user.rooms.forEach(conversationId => {
            socket.leave(conversationId);

            // Remove user from conversation room tracking
            const room = this.conversationRooms.get(conversationId);
            if (room) {
              room.delete(user.userId);
            }

            // Notify other users in the room
            socket.to(conversationId).emit('user_left', {
              userId: user.userId,
              conversationId,
              timestamp: new Date().toISOString()
            });
          });

          // Remove user from tracking
          this.users.delete(socket.id);
        }

        // Cleanup activity tracking and rate limit maps
        this.socketActivity.delete(socket.id);
        this.rateLimitMap.delete(socket.id);
        this.guestRateLimitMap.delete(socket.id);
      });
    });
  }

  // Cleanup method for graceful shutdown
  destroy() {
    if (this.idleTimeoutCleanup) {
      clearInterval(this.idleTimeoutCleanup);
      this.idleTimeoutCleanup = null;
    }

    // Disconnect all sockets
    for (const [socketId] of this.socketActivity) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
    }

    this.socketActivity.clear();
    this.rateLimitMap.clear();
    this.users.clear();
    this.conversationRooms.clear();
  }

  // Broadcast message to all users in a conversation
  broadcastToConversation(conversationId: string, event: string, data: any) {
    this.io.to(conversationId).emit(event, data);
  }

  // Send message to specific user
  sendToUser(userId: string, event: string, data: any) {
    // Find user's socket
    for (const [socketId, user] of this.users.entries()) {
      if (user.userId === userId) {
        user.socket.emit(event, data);
        break;
      }
    }
  }

  // Get active users in a conversation
  getActiveUsersInConversation(conversationId: string): string[] {
    const room = this.conversationRooms.get(conversationId);
    return room ? Array.from(room) : [];
  }

  private generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export function to initialize WebSocket service
export function initializeWebSocket(io: Server) {
  return new WebSocketService(io);
}