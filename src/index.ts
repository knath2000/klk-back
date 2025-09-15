import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import type { LLMMessage } from './types';

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

// Log environment variables for debugging
console.log('🔧 Environment Variables:', {
  LANGDB_GATEWAY_URL: process.env.LANGDB_GATEWAY_URL,
  LANGDB_API_KEY: process.env.LANGDB_API_KEY ? '[REDACTED]' : 'MISSING',
  LANGDB_TIMEOUT: process.env.LANGDB_TIMEOUT,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT || 3001
});

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

// Test LangDB endpoint for diagnostics
server.get('/api/test-langdb', async (req, res) => {
  try {
    const { LangDBAdapter } = await import('./services/langdbAdapter');
    const langdbAdapter = new LangDBAdapter(
      process.env.LANGDB_API_KEY || '',
      process.env.LANGDB_GATEWAY_URL || ''
    );
    const testMessages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    const options = { model: 'openai/gpt-5-mini', timeout: 10000 };
    const result = await langdbAdapter.fetchCompletion(testMessages, options);
    res.json({ status: 'success', response: result.substring(0, 100) });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      error: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      env: {
        LANGDB_GATEWAY_URL: process.env.LANGDB_GATEWAY_URL,
        LANGDB_API_KEY: process.env.LANGDB_API_KEY ? '[REDACTED]' : 'MISSING'
      }
    });
  }
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