import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Add these at the top of the file, after imports
process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  // Log to Modal dashboard before exit
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION:', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    timestamp: new Date().toISOString()
  });
  // Log to Modal dashboard before exit
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  shutdown();
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  shutdown();
});

// Shutdown function
async function shutdown() {
  try {
    // Close WebSocket connections
    if (io) {
      console.log('🔌 Closing WebSocket connections...');
      io.close();
    }
    
    // Clean up LLM adapter resources
    if (llmAdapter && typeof llmAdapter.cleanup === 'function') {
      console.log('🧹 Cleaning up LLM adapter...');
      llmAdapter.cleanup();
    }
    
    // Close HTTP server
    if (server) {
      console.log('🔌 Closing HTTP server...');
      await new Promise<void>((resolve) => {
        server.close(() => {
          console.log('✅ HTTP server closed');
          resolve();
        });
      });
    }
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

import { ChatService } from './services/chatService';
import { LangDBAdapter } from './services/langdbAdapter';
import personasRouter from './routes/personas';
import { personaService } from './services/personaService';

// Initialize Express app
const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  // Railway WebSocket support
  transports: ['websocket', 'polling']
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/personas', personasRouter);

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

// Smart Readiness Endpoint
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

// Health Check Endpoint for Detailed Monitoring
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
  startupPhases.server_listening = Date.now();
  console.log(`✅ SERVER SUCCESSFULLY RUNNING ON PORT ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 LLM Adapter: ${llmAdapter.isReady() ? 'READY' : 'NOT READY'}`);
  
  // NOW run validation AFTER server is listening
  validateStartup().then((isValid) => {
    if (isValid) {
      startupPhases.ready_for_traffic = Date.now();
      console.log(`🎯 READY FOR TRAFFIC: +${startupPhases.ready_for_traffic - startupPhases.process_start}ms total`);
      console.log(`🎯 Ready to accept connections - all validations passed`);
    } else {
      console.error('❌ Startup validation failed - but server is running');
      // Don't exit - let Railway handle restarts
    }
  }).catch((error) => {
    console.error('❌ Startup validation error:', error);
  });
});