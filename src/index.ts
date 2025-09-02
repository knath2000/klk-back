import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { ChatService } from './services/chatService';
import { LangDBAdapter } from './services/langdbAdapter';
import personasRouter from './routes/personas';
import { personaService } from './services/personaService';

// Initialize Express app
const app = express();
const server = createServer(app);

// Add comprehensive CORS headers
app.use((req, res, next) => {
  const allowedOrigins = process.env.FRONTEND_URL ? 
    process.env.FRONTEND_URL.split(',').map(url => url.trim()) : 
    ["http://localhost:3000", "https://klk-front.vercel.app"];
  
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

// Initialize Socket.IO with proper CORS for Vercel
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL ? 
      process.env.FRONTEND_URL.split(',').map(url => url.trim()) : 
      ["http://localhost:3000", "https://klk-front.vercel.app"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Routes
app.use('/api/personas', personasRouter);

// Add Railway health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Add Railway-specific ready check
app.get('/ready', (req, res) => {
  res.status(200).json({ 
    status: 'ready',
    timestamp: new Date().toISOString(),
    connections: io ? io.engine.clientsCount : 0
  });
});

// Add these signal handlers BEFORE the server.listen() call

// Graceful shutdown handling
let serverClosed = false;

const gracefulShutdown = async (signal: string) => {
  if (serverClosed) return;
  
  serverClosed = true;
  console.log(`${signal} received, shutting down gracefully...`);
  
  try {
    // Close WebSocket connections
    if (io) {
      io.close(() => {
        console.log('WebSocket server closed');
      });
    }
    
    // Close HTTP server
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log('HTTP server closed');
        resolve();
      });
    });
    
    console.log('Server shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle SIGTERM (graceful shutdown)
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  gracefulShutdown('SIGTERM');
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  gracefulShutdown('SIGINT');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let Railway handle restarts
});

// Track startup phases and validation state
const startupPhases = {
  process_start: Date.now(),
  server_listening: 0,
  validation_start: 0,
  validation_complete: 0,
  ready_for_traffic: 0
};

// Validation state tracking
let startupValidationComplete = false;
let startupValidationResult = false;

// Smart Readiness Endpoint - retained for backwards compatibility
// Railway Circuit Breaker should be enabled to handle availability seamlessly
app.get('/', (req, res) => {
  const timestamp = new Date().toISOString();
  const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';
  
  console.log(`🔍 READINESS PROBE: ${timestamp}`);
  console.log(`   Client: ${clientIP}`);
  console.log(`   Method: ${req.method} ${req.path}`);
  console.log(`   User-Agent: ${req.get('User-Agent') || 'N/A'}`);
  console.log(`   Validation Status: ${startupValidationComplete ? 'COMPLETE' : 'PENDING'}`);
  console.log(`   Validation Result: ${startupValidationComplete ? (startupValidationResult ? 'PASS' : 'FAIL') : 'N/A'}`);
  
  // If validation hasn't completed yet, return 503 (Service Unavailable)
  if (!startupValidationComplete) {
    console.log('⏳ READINESS PROBE: Validation not complete yet');
    return res.status(503).json({
      status: 'starting',
      message: 'Server starting, validation in progress',
      timestamp
    });
  }
  
  // If validation failed, return 503
  if (!startupValidationResult) {
    console.log('❌ READINESS PROBE: Validation failed');
    return res.status(503).json({
      status: 'unhealthy',
      message: 'Server validation failed',
      timestamp
    });
  }
  
  // All good - return 200
  res.set({
    'Content-Type': 'application/json',
    'X-Health-Check': 'ok',
    'X-Server-Status': 'ready',
    'X-Timestamp': timestamp
  });
  
  res.status(200).json({
    status: 'ok',
    message: 'Server is ready for traffic',
    timestamp,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// Health Check Endpoint for Detailed Monitoring - DO NOT REMOVE
// Railway deploys require an HTTP health check to confirm networking 
// connectivity before binding public addresses to the container
// If this doesn't work, use Railway's Circuit Breaker functionality:
// https://docs.railway.app/en/compute/smart-detection
// Remember to engage DRY Principle! Extract common logic into functions
app.get('/health', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`🏥 HEALTH CHECK: ${timestamp} - ${req.ip}`);
  
  const healthStatus = {
    server: 'ok',
    startup_validation: {
      complete: startupValidationComplete,
      result: startupValidationResult
    },
    personas: personaService.getAllPersonas().length,
    llm_adapter: llmAdapter.isReady(),
    websocket: io ? 'ok' : 'error',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp
  };
  
  const isHealthy = healthStatus.startup_validation.complete && 
                    healthStatus.startup_validation.result &&
                    healthStatus.personas > 0;
  
  res.status(isHealthy ? 200 : 503).json(healthStatus);
});

// Enhanced Startup Validation Function
async function validateStartup(): Promise<boolean> {
  try {
    startupPhases.validation_start = Date.now();
    console.log(`🔧 STARTING VALIDATION: +${startupPhases.validation_start - startupPhases.server_listening}ms`);
    console.log('🔧 VALIDATING STARTUP DEPENDENCIES...');
    
    // Check personas
    const personas = personaService.getAllPersonas();
    console.log(`📚 Personas loaded: ${personas.length}`);
    if (personas.length === 0) {
      console.error('❌ No personas loaded');
      startupValidationResult = false;
      startupValidationComplete = true;
      startupPhases.validation_complete = Date.now();
      console.log(`❌ VALIDATION COMPLETE (FAILED): +${startupPhases.validation_complete - startupPhases.validation_start}ms`);
      return false;
    }
    
    // Check LLM adapter
    const llmReady = llmAdapter.isReady();
    console.log(`🤖 LLM Adapter ready: ${llmReady}`);
    
    // Check environment
    const requiredEnv = ['LANGDB_API_KEY', 'LANGDB_GATEWAY_URL'];
    const missingEnv = requiredEnv.filter(key => !process.env[key]);
    if (missingEnv.length > 0) {
      console.warn(`⚠️ Missing environment variables: ${missingEnv.join(', ')}`);
    }
    
    console.log('✅ STARTUP VALIDATION COMPLETE');
    startupValidationResult = true;
    startupValidationComplete = true;
    startupPhases.validation_complete = Date.now();
    console.log(`✅ VALIDATION COMPLETE (SUCCESS): +${startupPhases.validation_complete - startupPhases.validation_start}ms`);
    return true;
    
  } catch (error) {
    console.error('❌ STARTUP VALIDATION ERROR:', error);
    startupValidationResult = false;
    startupValidationComplete = true;
    startupPhases.validation_complete = Date.now();
    console.log(`❌ VALIDATION COMPLETE (ERROR): +${startupPhases.validation_complete - startupPhases.validation_start}ms`);
    return false;
  }
}

// Initialize LLM Adapter
const llmAdapter = new LangDBAdapter(
  process.env.LANGDB_API_KEY || '',
  process.env.LANGDB_GATEWAY_URL || 'https://api.us-east-1.langdb.ai/ad29a93e-567e-4cad-a816-fff3d4215d2b/v1',
  parseInt(process.env.REQUEST_TIMEOUT || '30000')
);

// Initialize Chat Service
const chatService = new ChatService(llmAdapter);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  
  // Handle user messages
  socket.on('user_message', async (payload) => {
    try {
      await chatService.handleUserMessage(socket, payload);
    } catch (error) {
      console.error('Error handling user message:', error);
      socket.emit('error', {
        message: 'Failed to process message',
        code: 'PROCESSING_ERROR'
      });
    }
  });
  
  // Handle message cancellation
  socket.on('cancel_message', async (payload) => {
    try {
      const { message_id } = payload;
      await chatService.cancelRequest(message_id);
      socket.emit('message_cancelled', { message_id });
    } catch (error) {
      console.error('Error cancelling message:', error);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Express error:', err);
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// Start server with enhanced diagnostics
const PORT = parseInt(process.env.PORT || '3001');
// Remove HOST binding - Railway handles networking automatically

console.log(`🚀 STARTING SERVER INITIALIZATION...`);
console.log(`📍 Target Port: ${PORT}`);

// Add startup timing diagnostics
if (process.env.MODAL_STARTUP) {
  console.log('🎯 MODAL STARTUP MODE DETECTED');
  console.log(`⏰ Startup timestamp: ${new Date().toISOString()}`);
  console.log(`🔢 Process PID: ${process.pid}`);
  console.log(`👤 Process UID: ${process.getuid?.() || 'N/A'}`);
}

// Now listen immediately - Railway will only expose port when 
// container process writes to stdout, stderr, or /tmp/app-initialized
server.listen(PORT, () => {
  console.log(`✅ SERVER SUCCESSFULLY RUNNING ON PORT ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 LLM Adapter: ${llmAdapter.isReady() ? 'READY' : 'NOT READY'}`);
  
  // Add memory usage logging periodically
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    console.log(`Memory usage: ${JSON.stringify(memoryUsage)}`);
    
    // Warn if memory usage is high
    if (memoryUsage.rss > 500 * 1024 * 1024) { // 500MB
      console.warn('High memory usage detected');
    }
  }, 30000); // Log every 30 seconds
});