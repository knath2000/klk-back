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
import { neonAuthMiddleware, optionalNeonAuthMiddleware } from './middleware/auth';
import { collaborationService } from './services/collaborationService';
import { initializeWebSocket } from './services/websocket';
import { translationService } from './services/translationService';

dotenv.config();

// === DIAGNOSTIC LOGGING: STARTUP ENVIRONMENT ===
console.log('🔍 [STARTUP] Initializing server environment...');
console.log('🔍 [STARTUP] Environment Variables:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT || 3001,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY 
    ? `[SET - length: ${process.env.OPENROUTER_API_KEY.length}]` 
    : '[MISSING]',
  STACK_PROJECT_ID: process.env.NEXT_PUBLIC_STACK_PROJECT_ID || process.env.STACK_PROJECT_ID 
    ? '[SET]' 
    : '[MISSING]',
  DATABASE_URL: process.env.DATABASE_URL 
    ? '[SET]' 
    : '[MISSING]',
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
});

// === VALIDATE OPENROUTER_API_KEY ===
let STARTUP_ERROR: string | null = null;
const rawApiKey = process.env.OPENROUTER_API_KEY || '';
const trimmedApiKey = rawApiKey.trim();

if (!trimmedApiKey || trimmedApiKey.length === 0) {
  STARTUP_ERROR = 'OPENROUTER_API_KEY not configured or empty - server will operate in degraded mode';
  console.error(`❌ ${STARTUP_ERROR}`);
} else {
  console.log(`✅ OPENROUTER_API_KEY is configured (length: ${trimmedApiKey.length})`);
}

const server = express();
const httpServer = http.createServer(server);

// === TRY/CATCH: SOCKET.IO & WEBSOCKET INITIALIZATION ===
let io: Server | null = null;
let webSocketService: any = null;

try {
  console.log('🔧 [STARTUP] Initializing Socket.IO with Railway proxy configuration...');
  // Initialize Socket.IO with enhanced configuration for Railway proxy
  io = new Server(httpServer, {
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

  console.log('✅ [STARTUP] Socket.IO initialized successfully');

  // Initialize WebSocket service with translation support
  console.log('🔧 [STARTUP] Initializing WebSocket service...');
  webSocketService = initializeWebSocket(io);
  console.log('✅ [STARTUP] WebSocket service initialized');
} catch (socketErr: any) {
  const errMsg = `Failed to initialize Socket.IO: ${socketErr?.message}`;
  STARTUP_ERROR = STARTUP_ERROR ? `${STARTUP_ERROR}; ${errMsg}` : errMsg;
  console.error(`❌ ${errMsg}`);
}

// Enhanced CORS middleware for HTTP (affects polling fallback)
server.use(cors({
  origin: [
    "https://klk-front.vercel.app",
    "http://localhost:3000"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add cookie parser middleware
server.use(cookieParser());

// Add OPTIONS handler for preflight
server.options('*', cors({
  origin: [
    "https://klk-front.vercel.app",
    "http://localhost:3000"
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

server.use(express.json());

// Public routes (no auth)
server.get('/api/health', (req, res) => {
  // If there's a startup error, still return 200 with error details in JSON
  // This allows Render logs to capture the error and prevents silent 503s
  res.status(200).json({
    status: STARTUP_ERROR ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    websocketInitialized: !!webSocketService,
    socketIOReady: !!io,
    translationServiceReady: true,
    openRouterConfigured: !!trimmedApiKey,
    startupError: STARTUP_ERROR || null,
    diagnostics: {
      apiKeyLength: trimmedApiKey.length,
      hasSocketIO: !!io,
      hasWebSocketService: !!webSocketService
    }
  });
});

// Authenticated API routes (require valid Neon Auth JWT)
server.use('/api/conversations', neonAuthMiddleware, conversationsRouter);
server.use('/api/subscription', neonAuthMiddleware, subscriptionRouter);
server.use('/api/search', neonAuthMiddleware, searchRouter);
server.use('/api/teams', neonAuthMiddleware, teamsRouter);
server.use('/api/analytics', neonAuthMiddleware, analyticsRouter);
server.use('/api/collaboration', neonAuthMiddleware, collaborationRouter);
server.use('/api/translate', optionalNeonAuthMiddleware, translateRouter);

// Public/Auth routes (Logout should be here)
server.use('/api/auth', authRouter);

// Optionally public (leave personas + models open, or secure later if needed)
server.use('/api/personas', personasRouter);
server.use('/api/models', modelsRouter);

const PORT = process.env.PORT || 3001;

// === TRY/CATCH: SERVER STARTUP ===
try {
  httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 WebSocket server initialized with real-time collaboration`);
    if (STARTUP_ERROR) {
      console.warn(`⚠️ [STARTUP WARNING] ${STARTUP_ERROR}`);
    } else {
      console.log('✅ [STARTUP] All services initialized successfully');
    }
  });
} catch (startupErr: any) {
  console.error(`❌ [STARTUP FATAL] Failed to start server: ${startupErr?.message}`);
  // Don't exit immediately; try a fallback
  try {
    console.log('🔄 [STARTUP] Attempting fallback on alternate port...');
    const fallbackPort = 3002;
    httpServer.listen(fallbackPort, () => {
      console.log(`🚀 [FALLBACK] Server running on fallback port ${fallbackPort}`);
    });
  } catch (fallbackErr: any) {
    console.error(`❌ [FALLBACK] Could not start fallback server: ${fallbackErr?.message}`);
    process.exit(1);
  }
}

// Graceful shutdown for Railway
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (io) {
    io.close(() => {
      httpServer.close(() => {
        process.exit(0);
      });
    });
  } else {
    httpServer.close(() => {
      process.exit(0);
    });
  }
});
