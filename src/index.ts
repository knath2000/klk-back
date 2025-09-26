import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import type { LLMMessage } from './types';
import cookieParser from 'cookie-parser'; // Import cookie-parser

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
import authRouter from './routes/auth';

// Import services
import { getSupabase } from './services/db';
import { neonAuthMiddleware } from './middleware/auth';
import { collaborationService } from './services/collaborationService';
import { initializeWebSocket } from './services/websocket';
import { translationService } from './services/translationService';

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

// Add cookie parser middleware
server.use(cookieParser());

// Add OPTIONS handler for preflight
server.options('*', cors());

server.use(express.json());

// Public routes (no auth)
server.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    websocketInitialized: !!webSocketService,
    translationServiceReady: true,
    openRouterReady: !!process.env.OPENROUTER_API_KEY
  });
});

server.get('/api/test-openrouter', async (req, res) => {
  try {
    const { OpenRouterAdapter } = await import('./services/openrouterAdapter');
    const openRouterAdapter = new OpenRouterAdapter(
      process.env.OPENROUTER_API_KEY || '',
      process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    );
    const testMessages: LLMMessage[] = [{ role: 'user', content: 'test' }];
    const options = { model: process.env.OPENROUTER_MODEL || 'gpt-4o-mini', timeout: 10000 };
    const result = await openRouterAdapter.fetchCompletion(testMessages, options);
    res.json({ status: 'success', response: result.substring(0, 100) });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      error: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      env: {
        OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? '[REDACTED]' : 'MISSING',
        OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'gpt-4o-mini'
      }
    });
  }
});

// Authenticated API routes (require valid Neon Auth JWT)
server.use('/api/conversations', neonAuthMiddleware, conversationsRouter);
server.use('/api/subscription', neonAuthMiddleware, subscriptionRouter);
server.use('/api/search', neonAuthMiddleware, searchRouter);
server.use('/api/teams', neonAuthMiddleware, teamsRouter);
server.use('/api/analytics', neonAuthMiddleware, analyticsRouter);
server.use('/api/collaboration', neonAuthMiddleware, collaborationRouter);
server.use('/api/translate', neonAuthMiddleware, translateRouter);

// Public/Auth routes (Logout should be here)
server.use('/api/auth', authRouter);

// Optionally public (leave personas + models open, or secure later if needed)
server.use('/api/personas', personasRouter);
server.use('/api/models', modelsRouter);

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