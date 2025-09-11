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
        this.metrics = {
            requests: { count: 0, inc: () => this.metrics.requests.count++ },
            successes: { count: 0, inc: () => this.metrics.successes.count++ },
            errors: { count: 0, inc: () => this.metrics.errors.count++ }
        };
        this.io = io;
        this.setupWebSocketHandlers();
    }
    setupWebSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log('User connected:', socket.id);
            // Add catch-all event handler for debugging unhandled events
            socket.onAny((event, ...args) => {
                if (!['connect', 'disconnect', 'ping', 'pong'].includes(event)) {
                    console.log('🔍 UNHANDLED EVENT:', event, 'from', socket.id, 'args:', args.length > 0 ? JSON.stringify(args[0]).substring(0, 200) : 'no args');
                }
            });
            // Add error handling for reconnects
            socket.on('connect_error', (err) => {
                console.error('Socket.IO connect error:', err.message);
                // Emit to client for retry
                socket.emit('reconnect_attempt', { delay: 1000 });
            });
            // Add reconnect event handler
            socket.on('reconnect', () => {
                console.log('Client reconnected:', socket.id);
                // Re-join previous rooms if stored
                // Logic to re-join from userRooms map can be added here
            });
            // Enhanced translation request handling with rate limiting and metrics
            socket.on('translation_request', async (data) => {
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
                    if (!data.query) {
                        socket.emit('translation_error', { message: 'Query is required' });
                        return;
                    }
                    // Validate connection state
                    if (!socket.connected) {
                        console.warn('Translation request from disconnected socket:', socket.id);
                        socket.emit('translation_error', { message: 'Connection lost; please retry' });
                        return;
                    }
                    // Call translation service
                    const result = await translationService_1.translationService.translate({
                        text: data.query,
                        sourceLang: data.language || 'en',
                        targetLang: 'es',
                        context: data.context,
                        userId: socket.id // Use socket ID for session
                    });
                    // Stream response (delta for partial, final for complete)
                    if (transport === 'websocket') {
                        // Stream deltas if websocket (implement true streaming with chunks)
                        const firstDefinition = result.definitions[0]?.meaning || 'Translation completed';
                        const chunks = firstDefinition.split(' '); // Simple word-based streaming
                        chunks.forEach((chunk, index) => {
                            setTimeout(() => {
                                socket.emit('translation_delta', { chunk, index, total: chunks.length });
                            }, index * 100); // 100ms delay per chunk
                        });
                        setTimeout(() => {
                            socket.emit('translation_final', result);
                        }, chunks.length * 100 + 500);
                    }
                    else {
                        // Polling-friendly: Send full result
                        socket.emit('translation_final', result);
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
                    // Use OpenRouter for chat (as per existing setup)
                    const openRouterAdapter = new openrouterAdapter_1.OpenRouterAdapter(process.env.OPENROUTER_API_KEY || '', process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1');
                    const options = {
                        model: 'gpt-4o-mini',
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
                console.log('🔌 WebSocket DISCONNECTED:', reason, 'transport:', transport, 'at', new Date().toISOString());
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
                // Cleanup rate limit map
                this.rateLimitMap.delete(socket.id);
            });
        });
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