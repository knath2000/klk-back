import { Server, Socket } from 'socket.io';
import { collaborationService } from './collaborationService';
import { conversationService } from './conversationService';
import { translationService } from './translationService';

interface WebSocketUser {
  userId: string;
  socket: Socket;
  rooms: Set<string>; // conversation IDs
}

class WebSocketService {
  private io: Server;
  private users: Map<string, WebSocketUser> = new Map();
  private conversationRooms: Map<string, Set<string>> = new Map(); // conversationId -> Set of userIds

  constructor(io: Server) {
    this.io = io;
    this.setupWebSocketHandlers();
  }

  private setupWebSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

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

      // Add transport-aware translation request handling
      socket.on('translation_request', async (data) => {
        console.log('Received translation_request:', data);
        const transport = socket.conn?.transport?.name || 'unknown';
        console.log('Translation request transport:', transport);

        try {
          // Proceed with streaming if websocket
          if (transport === 'websocket') {
            // Use the translation service's translate method
            const result = await translationService.translate({
              text: data.query,
              sourceLang: data.language || 'en',
              targetLang: 'es',
              context: data.context,
              userId: data.userId
            });

            // Emit streaming results
            socket.emit('translation_delta', result);
            socket.emit('translation_final', result);
          } else {
            // Fallback to polling-friendly handling
            console.log('Using polling transport for translation');
            // Emit fallback event or queue for polling
            socket.emit('translation_fallback', { data, transport });
          }
        } catch (err) {
          console.error('Translation request error:', err);
          const errorMessage = err instanceof Error ? err.message : 'Unknown translation error';
          socket.emit('translation_error', { message: errorMessage, retry: true });
        }
      });

      // Add general error handler for connection issues
      this.io.engine.on('connection_error', (err) => {
        console.error('Socket.IO engine connection error:', err);
      });

      // User authentication
      socket.on('authenticate', (userId: string) => {
        this.users.set(socket.id, {
          userId,
          socket,
          rooms: new Set()
        });
        console.log('User authenticated:', userId);
      });

      // Join conversation room
      socket.on('join_conversation', async (data: { conversationId: string; userId: string }) => {
        const { conversationId, userId } = data;
        
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
      socket.on('send_message', async (data: { 
        conversationId: string; 
        userId: string; 
        content: string; 
        role: 'user' | 'assistant';
        messageId?: string;
      }) => {
        const { conversationId, userId, content, role, messageId } = data;
        
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
      socket.on('conversation_shared', (data: { conversationId: string; sharedWith: string; permission: string; userId: string }) => {
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
      });
    });
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
}

// Export function to initialize WebSocket service
export function initializeWebSocket(io: Server) {
  return new WebSocketService(io);
}