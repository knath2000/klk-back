"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeWebSocket = initializeWebSocket;
const openrouterAdapter_1 = require("./openrouterAdapter");
const personaService_1 = require("./personaService");
const collaborationService_1 = require("./collaborationService");
const conversationService_1 = require("./conversationService");
const translationService_1 = require("./translationService");
class WebSocketService {
    constructor(io) {
        this.users = new Map();
        this.conversationRooms = new Map(); // conversationId -> Set of userIds
        this.rateLimitMap = new Map();
        this.socketActivity = new Map(); // socketId -> lastActivity
        this.idleTimeoutCleanup = null;
        this.metrics = {
            requests: { count: 0, inc: () => this.metrics.requests.count++ },
            successes: { count: 0, inc: () => this.metrics.successes.count++ },
            errors: { count: 0, inc: () => this.metrics.errors.count++ }
        };
        this.io = io;
        this.setupWebSocketHandlers();
        this.startIdleTimeoutCleanup();
    }
    startIdleTimeoutCleanup() {
        // Clean up idle connections every 5 minutes
        this.idleTimeoutCleanup = setInterval(() => {
            this.cleanupIdleConnections();
        }, 5 * 60 * 1000); // 5 minutes
    }
    cleanupIdleConnections() {
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
    updateActivity(socketId) {
        this.socketActivity.set(socketId, Date.now());
    }
    setupWebSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log('User connected:', socket.id);
            // Initialize activity tracking
            this.updateActivity(socket.id);
            // Check for session ID in query parameters for reconnection
            const sessionId = socket.handshake.query.sessionId;
            if (sessionId) {
                console.log('🔄 Session ID detected:', sessionId, 'for socket:', socket.id);
                // Store session mapping for potential state restoration
                socket.sessionId = sessionId;
            }
            // Add catch-all event handler for debugging unhandled events
            socket.onAny((event, ...args) => {
                if (!['connect', 'disconnect', 'ping', 'pong', 'translation_request', 'user_message'].includes(event)) {
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
                const sessionId = socket.sessionId;
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
            socket.on('translation_request', async (data) => {
                // Update activity timestamp
                this.updateActivity(socket.id);
                console.log('📨 Received translation_request:', { ...data, id: socket.id });
                const transport = socket.conn?.transport?.name || 'unknown';
                console.log('Transport for translation_request:', transport);
                // Rate limiting: Simple in-memory check (consider Redis for production)
                const now = Date.now();
                const userKey = socket.id;
                const rateLimitData = this.rateLimitMap.get(userKey);
                if (!rateLimitData) {
                    this.rateLimitMap.set(userKey, { count: 0, resetTime: now + 60000 }); // 1 min window
                }
                const currentLimit = this.rateLimitMap.get(userKey);
                if (currentLimit.count >= 10) { // 10 requests per minute
                    socket.emit('translation_error', { message: 'Rate limit exceeded. Please wait.' });
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
                        result = await translationService_1.translationService.translate({
                            text: data.query,
                            sourceLang: data.language || 'en',
                            targetLang: 'es',
                            context: data.context,
                            userId: socket.id // Use socket ID for session
                        });
                        console.log('✅ Translation service returned result for:', data.query, 'keys:', Object.keys(result));
                    }
                    catch (translationError) {
                        console.error('❌ Translation service error for', data.query, ':', translationError.message);
                        socket.emit('translation_error', { message: translationError.message || 'Translation failed' });
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
                        const firstDefinition = result.definitions[0]?.text || result.definitions[0]?.meaning || 'Translation completed';
                        const chunks = firstDefinition.split(' '); // Simple word-based streaming
                        chunks.forEach((chunk, index) => {
                            setTimeout(() => {
                                socket.emit('translation_delta', { chunk, index, total: chunks.length, id: frontendResult.id });
                            }, index * 100); // 100ms delay per chunk
                        });
                        setTimeout(() => {
                            console.log('📤 Emitting translation_final for:', frontendResult.id, 'to socket:', socket.id);
                            socket.emit('translation_final', frontendResult);
                        }, chunks.length * 100 + 500);
                    }
                    else {
                        // Polling-friendly: Send full result
                        console.log('📤 Emitting translation_final for:', frontendResult.id, 'to socket:', socket.id, '(polling transport)');
                        socket.emit('translation_final', frontendResult);
                    }
                    // Metrics: Increment success counter
                    this.metrics.successes.inc();
                    console.log('Translation completed for query:', data.query);
                }
                catch (error) {
                    console.error('Translation processing error:', error);
                    // Metrics: Increment error counter
                    this.metrics.errors.inc();
                    socket.emit('translation_error', { message: error.message || 'Translation failed' });
                }
            });
            // New user_message handler for chat messages
            socket.on('user_message', async (data) => {
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
                const currentLimit = this.rateLimitMap.get(userKey);
                if (currentLimit.count >= 5) { // 5 messages per minute for chat
                    socket.emit('error', { message: 'Rate limit exceeded. Please wait.' });
                    return;
                }
                currentLimit.count++;
                // Metrics
                this.metrics.requests.inc();
                try {
                    if (!data.message.trim()) {
                        socket.emit('error', { message: 'Message cannot be empty' });
                        return;
                    }
                    if (!data.selected_country_key) {
                        socket.emit('error', { message: 'Please select a country first' });
                        return;
                    }
                    // Validate connection
                    if (!socket.connected) {
                        console.warn('user_message from disconnected socket:', socket.id);
                        socket.emit('error', { message: 'Connection lost; please retry' });
                        return;
                    }
                    // Fetch persona
                    const persona = await personaService_1.personaService.getPersona(data.selected_country_key);
                    if (!persona) {
                        socket.emit('error', { message: 'Invalid country selection' });
                        return;
                    }
                    // Prepare LLM messages
                    const messages = [
                        { role: 'system', content: persona.prompt_text },
                        { role: 'user', content: data.message }
                    ];
                    // Use OpenRouter for chat
                    const openRouterAdapter = new openrouterAdapter_1.OpenRouterAdapter(process.env.OPENROUTER_API_KEY || '', process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1');
                    const options = {
                        model: process.env.OPENROUTER_MODEL || 'gpt-4o-mini',
                        timeout: 30000,
                        requestId: data.message_id
                    };
                    // Stream response
                    const stream = openRouterAdapter.streamCompletion(messages, options);
                    let fullContent = '';
                    for await (const chunk of stream) {
                        if (chunk.deltaText) {
                            fullContent += chunk.deltaText;
                            socket.emit('assistant_delta', {
                                message_id: data.message_id,
                                chunk: chunk.deltaText,
                                index: fullContent.length,
                                total: null // Unknown total for streaming
                            });
                        }
                    }
                    // Emit final message
                    socket.emit('assistant_final', {
                        message_id: data.message_id,
                        final_content: fullContent,
                        timestamp: new Date().toISOString()
                    });
                    // Metrics
                    this.metrics.successes.inc();
                    console.log('✅ User message processed for:', data.message_id, 'content length:', fullContent.length);
                }
                catch (error) {
                    console.error('❌ User message processing error:', error);
                    this.metrics.errors.inc();
                    socket.emit('error', {
                        message: 'Sorry, I encountered an error processing your message. Please try again.',
                        details: error.message
                    });
                }
            });
            // Add general error handler for connection issues
            this.io.engine.on('connection_error', (err) => {
                console.error('Socket.IO engine connection error:', err.req?.url, err.type, err.message);
            });
            // User authentication
            socket.on('authenticate', (userId) => {
                this.users.set(socket.id, {
                    userId,
                    socket,
                    rooms: new Set()
                });
                console.log('User authenticated:', userId);
            });
            // Join conversation room
            socket.on('join_conversation', async (data) => {
                const { conversationId, userId } = data;
                try {
                    // Check if user has access to conversation
                    const hasAccess = await collaborationService_1.collaborationService.hasAccessToConversation(conversationId, userId);
                    const conversation = await conversationService_1.conversationService.getConversation(conversationId);
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
                }
                catch (error) {
                    console.error('Error joining conversation:', error);
                    socket.emit('error', { message: 'Failed to join conversation' });
                }
            });
            // Leave conversation room
            socket.on('leave_conversation', (data) => {
                const { conversationId, userId } = data;
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
            socket.on('send_message', async (data) => {
                const { conversationId, userId, content, role, messageId } = data;
                try {
                    // Check if user has access to conversation
                    const hasAccess = await collaborationService_1.collaborationService.hasAccessToConversation(conversationId, userId);
                    const conversation = await conversationService_1.conversationService.getConversation(conversationId);
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
                    const message = await conversationService_1.conversationService.addMessage(messageData);
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
                }
                catch (error) {
                    console.error('Error sending message:', error);
                    socket.emit('error', { message: 'Failed to send message' });
                }
            });
            // Typing indicator
            socket.on('typing', (data) => {
                const { conversationId, userId, isTyping } = data;
                // Broadcast typing status to all users in the conversation room
                socket.to(conversationId).emit('user_typing', {
                    userId,
                    conversationId,
                    isTyping,
                    timestamp: new Date().toISOString()
                });
            });
            // Conversation shared
            socket.on('conversation_shared', (data) => {
                const { conversationId, sharedWith, permission, userId } = data;
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
                const sessionId = socket.sessionId;
                // Enhanced disconnect logging with reason categorization
                let disconnectCategory = 'unknown';
                if (reason === 'io client disconnect') {
                    disconnectCategory = 'client_initiated';
                }
                else if (reason === 'transport close') {
                    disconnectCategory = 'transport_closed';
                }
                else if (reason === 'ping timeout') {
                    disconnectCategory = 'ping_timeout';
                }
                else if (reason === 'transport error') {
                    disconnectCategory = 'transport_error';
                }
                else {
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
                // Cleanup activity tracking and rate limit map
                this.socketActivity.delete(socket.id);
                this.rateLimitMap.delete(socket.id);
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
    broadcastToConversation(conversationId, event, data) {
        this.io.to(conversationId).emit(event, data);
    }
    // Send message to specific user
    sendToUser(userId, event, data) {
        // Find user's socket
        for (const [socketId, user] of this.users.entries()) {
            if (user.userId === userId) {
                user.socket.emit(event, data);
                break;
            }
        }
    }
    // Get active users in a conversation
    getActiveUsersInConversation(conversationId) {
        const room = this.conversationRooms.get(conversationId);
        return room ? Array.from(room) : [];
    }
}
// Export function to initialize WebSocket service
function initializeWebSocket(io) {
    return new WebSocketService(io);
}
//# sourceMappingURL=websocket.js.map