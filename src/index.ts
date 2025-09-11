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
import { initializeWebSocket } from './services/websocket';

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

// Initialize WebSocket service with translation support
const webSocketService = initializeWebSocket(io);

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
    websocketInitialized: !!webSocketService,
    translationServiceReady: true
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