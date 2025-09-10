import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

// Import routes
import conversationsRouter from './routes/conversations';
import personasRouter from './routes/personas';
import modelsRouter from './routes/models';
import subscriptionRouter from './routes/subscription';
import searchRouter from './routes/search';
import teamsRouter from './routes/teams';
import analyticsRouter from './routes/analytics';
import collaborationRouter from './routes/collaboration';
import translateRouter from './routes/translate';

// Import services
import { getSupabase } from './services/db';
import { collaborationService } from './services/collaborationService';

dotenv.config();

const server = express();
const httpServer = http.createServer(server);

// Initialize Socket.IO with enhanced configuration for Railway proxy
const io = new Server(httpServer, {
  path: '/socket.io', // Explicit path to avoid proxy conflicts
  cors: {
    origin: [
      "https://klk-front.vercel.app",
      "https://klk-front.vercel.app/translate", // Specific for tab
      "http://localhost:3000"
    ],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ['websocket', 'polling'],
  upgradeTimeout: 20000, // Increased for Railway proxy
  pingTimeout: 120000, // Doubled for intermittent reconnects
  pingInterval: 30000,
  maxHttpBufferSize: 1e6,
  allowEIO3: true // Fallback for version mismatches
});

// Store active users and their conversations
const userRooms = new Map<string, Set<string>>(); // userId -> Set of conversationIds
const conversationRooms = new Map<string, Set<string>>(); // conversationId -> Set of userIds

// Enhanced WebSocket handlers for real-time collaboration
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  let currentUserId: string | null = null;
  let currentConversationId: string | null = null;

  // Authentication
  socket.on('authenticate', (userId: string) => {
    console.log('User authenticated:', userId);
    currentUserId = userId;
    
    // Store user connection
    if (!userRooms.has(userId)) {
      userRooms.set(userId, new Set());
    }
  });

  // Join conversation room
  socket.on('join_conversation', async (conversationId: string) => {
    if (!currentUserId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    try {
      // Check if user has access to this conversation
      const hasAccess = await collaborationService.hasAccessToConversation(conversationId, currentUserId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied to conversation' });
        return;
      }

      // Join the conversation room
      socket.join(`conversation:${conversationId}`);
      currentConversationId = conversationId;

      // Track user in conversation
      if (!conversationRooms.has(conversationId)) {
        conversationRooms.set(conversationId, new Set());
      }
      conversationRooms.get(conversationId)?.add(currentUserId);
      userRooms.get(currentUserId)?.add(conversationId);

      console.log(`User ${currentUserId} joined conversation ${conversationId}`);
      socket.emit('joined_conversation', { conversationId });

      // Notify other users in the conversation
      socket.to(`conversation:${conversationId}`).emit('user_joined', {
        userId: currentUserId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error joining conversation:', error);
      socket.emit('error', { message: 'Failed to join conversation' });
    }
  });

  // Leave conversation room
  socket.on('leave_conversation', (conversationId: string) => {
    if (!currentUserId) return;

    socket.leave(`conversation:${conversationId}`);
    
    // Remove user from tracking
    if (currentUserId) {
      conversationRooms.get(conversationId)?.delete(currentUserId);
      userRooms.get(currentUserId)?.delete(conversationId);
    }

    console.log(`User ${currentUserId} left conversation ${conversationId}`);
    
    // Notify other users in the conversation
    socket.to(`conversation:${conversationId}`).emit('user_left', {
      userId: currentUserId,
      timestamp: new Date().toISOString()
    });
  });

  // Send message to conversation
  socket.on('send_message', async (data: { conversationId: string; message: any }) => {
    if (!currentUserId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const { conversationId, message } = data;

    try {
      // Check if user has access to this conversation
      const hasAccess = await collaborationService.hasAccessToConversation(conversationId, currentUserId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied to conversation' });
        return;
      }

      // Add message to conversation
      const messageData = {
        conversation_id: conversationId,
        role: message.role || 'user',
        content: message.content,
        model: message.model,
        user_id: currentUserId,
        tokens_used: message.tokens_used
      };

      const savedMessage = await collaborationService.addCollaborativeMessage(conversationId, messageData);

      // Broadcast message to all users in the conversation
      const messagePayload = {
        message: savedMessage,
        senderId: currentUserId,
        timestamp: new Date().toISOString()
      };

      socket.to(`conversation:${conversationId}`).emit('message_received', messagePayload);
      socket.emit('message_sent', messagePayload);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Typing indicator
  socket.on('typing_start', (data: { conversationId: string }) => {
    if (!currentUserId || !data.conversationId) return;

    socket.to(`conversation:${data.conversationId}`).emit('user_typing', {
      userId: currentUserId,
      conversationId: data.conversationId,
      isTyping: true,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('typing_end', (data: { conversationId: string }) => {
    if (!currentUserId || !data.conversationId) return;

    socket.to(`conversation:${data.conversationId}`).emit('user_typing', {
      userId: currentUserId,
      conversationId: data.conversationId,
      isTyping: false,
      timestamp: new Date().toISOString()
    });
  });

  // Real-time cursor position (for collaborative editing)
  socket.on('cursor_position', (data: { conversationId: string; position: any }) => {
    if (!currentUserId || !data.conversationId) return;

    socket.to(`conversation:${data.conversationId}`).emit('user_cursor', {
      userId: currentUserId,
      conversationId: data.conversationId,
      position: data.position,
      timestamp: new Date().toISOString()
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (currentUserId) {
      // Clean up user from all conversations
      const userConversations = userRooms.get(currentUserId);
      if (userConversations) {
        userConversations.forEach(conversationId => {
          socket.to(`conversation:${conversationId}`).emit('user_left', {
            userId: currentUserId,
            timestamp: new Date().toISOString()
          });
          if (currentUserId) {
            conversationRooms.get(conversationId)?.delete(currentUserId);
          }
        });
        userRooms.delete(currentUserId);
      }
    }
  });
});

// Enhanced CORS middleware for HTTP (affects polling fallback)
server.use(cors({
  origin: [
    "https://klk-front.vercel.app",
    "http://localhost:3000"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add OPTIONS handler for preflight
server.options('*', cors());

server.use(express.json());

// Authentication middleware
server.use((req, res, next) => {
  // Simple auth check - in production, use proper JWT validation
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // TODO: Validate JWT token properly
    (req as any).user = { id: 'user-id-from-token' }; // Mock user for now
  }
  next();
});

// API Routes
server.use('/api/conversations', conversationsRouter);
server.use('/api/personas', personasRouter);
server.use('/api/models', modelsRouter);
server.use('/api/subscription', subscriptionRouter);
server.use('/api/search', searchRouter);
server.use('/api/teams', teamsRouter);
server.use('/api/analytics', analyticsRouter);
server.use('/api/collaboration', collaborationRouter);
server.use('/api/translate', translateRouter);

// Health check endpoint
server.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    activeUsers: userRooms.size,
    activeConversations: conversationRooms.size
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server initialized with real-time collaboration`);
});

// Graceful shutdown for Railway
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  io.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});