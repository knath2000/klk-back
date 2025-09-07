"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeWebSocket = initializeWebSocket;
const collaborationService_1 = require("./collaborationService");
const conversationService_1 = require("./conversationService");
class WebSocketService {
    constructor(io) {
        this.users = new Map();
        this.conversationRooms = new Map(); // conversationId -> Set of userIds
        this.io = io;
        this.setupWebSocketHandlers();
    }
    setupWebSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log('User connected:', socket.id);
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
            // Handle disconnection
            socket.on('disconnect', () => {
                console.log('User disconnected:', socket.id);
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