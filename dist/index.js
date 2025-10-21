"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const cookie_parser_1 = __importDefault(require("cookie-parser")); // Import cookie-parser
// Import routes
const conversations_1 = __importDefault(require("./routes/conversations"));
const personas_1 = __importDefault(require("./routes/personas"));
const models_1 = __importDefault(require("./routes/models"));
const subscription_1 = __importDefault(require("./routes/subscription"));
const search_1 = __importDefault(require("./routes/search"));
const teams_1 = __importDefault(require("./routes/teams"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const collaboration_1 = __importDefault(require("./routes/collaboration"));
const translate_1 = __importDefault(require("./routes/translate"));
const auth_1 = __importDefault(require("./routes/auth"));
const auth_2 = require("./middleware/auth");
const websocket_1 = require("./services/websocket");
dotenv_1.default.config();
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
let STARTUP_ERROR = null;
const rawApiKey = process.env.OPENROUTER_API_KEY || '';
const trimmedApiKey = rawApiKey.trim();
if (!trimmedApiKey || trimmedApiKey.length === 0) {
    STARTUP_ERROR = 'OPENROUTER_API_KEY not configured or empty - server will operate in degraded mode';
    console.error(`❌ ${STARTUP_ERROR}`);
}
else {
    console.log(`✅ OPENROUTER_API_KEY is configured (length: ${trimmedApiKey.length})`);
}
const server = (0, express_1.default)();
const httpServer = http_1.default.createServer(server);
// === TRY/CATCH: SOCKET.IO & WEBSOCKET INITIALIZATION ===
let io = null;
let webSocketService = null;
try {
    console.log('🔧 [STARTUP] Initializing Socket.IO with Railway proxy configuration...');
    // Initialize Socket.IO with enhanced configuration for Railway proxy
    io = new socket_io_1.Server(httpServer, {
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
    webSocketService = (0, websocket_1.initializeWebSocket)(io);
    console.log('✅ [STARTUP] WebSocket service initialized');
}
catch (socketErr) {
    const errMsg = `Failed to initialize Socket.IO: ${socketErr?.message}`;
    STARTUP_ERROR = STARTUP_ERROR ? `${STARTUP_ERROR}; ${errMsg}` : errMsg;
    console.error(`❌ ${errMsg}`);
}
// Enhanced CORS middleware for HTTP (affects polling fallback)
server.use((0, cors_1.default)({
    origin: [
        "https://klk-front.vercel.app",
        "http://localhost:3000"
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
// Add cookie parser middleware
server.use((0, cookie_parser_1.default)());
// Add OPTIONS handler for preflight
server.options('*', (0, cors_1.default)({
    origin: [
        "https://klk-front.vercel.app",
        "http://localhost:3000"
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));
server.use(express_1.default.json());
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
server.use('/api/conversations', auth_2.neonAuthMiddleware, conversations_1.default);
server.use('/api/subscription', auth_2.neonAuthMiddleware, subscription_1.default);
server.use('/api/search', auth_2.neonAuthMiddleware, search_1.default);
server.use('/api/teams', auth_2.neonAuthMiddleware, teams_1.default);
server.use('/api/analytics', auth_2.neonAuthMiddleware, analytics_1.default);
server.use('/api/collaboration', auth_2.neonAuthMiddleware, collaboration_1.default);
server.use('/api/translate', auth_2.optionalNeonAuthMiddleware, translate_1.default);
// Public/Auth routes (Logout should be here)
server.use('/api/auth', auth_1.default);
// Optionally public (leave personas + models open, or secure later if needed)
server.use('/api/personas', personas_1.default);
server.use('/api/models', models_1.default);
const PORT = process.env.PORT || 3001;
// === TRY/CATCH: SERVER STARTUP ===
try {
    httpServer.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📡 WebSocket server initialized with real-time collaboration`);
        if (STARTUP_ERROR) {
            console.warn(`⚠️ [STARTUP WARNING] ${STARTUP_ERROR}`);
        }
        else {
            console.log('✅ [STARTUP] All services initialized successfully');
        }
    });
}
catch (startupErr) {
    console.error(`❌ [STARTUP FATAL] Failed to start server: ${startupErr?.message}`);
    // Don't exit immediately; try a fallback
    try {
        console.log('🔄 [STARTUP] Attempting fallback on alternate port...');
        const fallbackPort = 3002;
        httpServer.listen(fallbackPort, () => {
            console.log(`🚀 [FALLBACK] Server running on fallback port ${fallbackPort}`);
        });
    }
    catch (fallbackErr) {
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
    }
    else {
        httpServer.close(() => {
            process.exit(0);
        });
    }
});
//# sourceMappingURL=index.js.map