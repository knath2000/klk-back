"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
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
const websocket_1 = require("./services/websocket");
dotenv_1.default.config();
// Log environment variables for debugging
console.log('🔧 Environment Variables:', {
    LANGDB_GATEWAY_URL: process.env.LANGDB_GATEWAY_URL,
    LANGDB_API_KEY: process.env.LANGDB_API_KEY ? '[REDACTED]' : 'MISSING',
    LANGDB_TIMEOUT: process.env.LANGDB_TIMEOUT,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT || 3001
});
const server = (0, express_1.default)();
const httpServer = http_1.default.createServer(server);
// Initialize Socket.IO with enhanced configuration for Railway proxy
const io = new socket_io_1.Server(httpServer, {
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
const webSocketService = (0, websocket_1.initializeWebSocket)(io);
// Enhanced CORS middleware for HTTP (affects polling fallback)
server.use((0, cors_1.default)({
    origin: [
        "https://klk-front.vercel.app",
        "http://localhost:3000"
    ],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
// Add OPTIONS handler for preflight
server.options('*', (0, cors_1.default)());
server.use(express_1.default.json());
// Authentication middleware
server.use((req, res, next) => {
    // Simple auth check - in production, use proper JWT validation
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        // TODO: Validate JWT token properly
        req.user = { id: 'user-id-from-token' }; // Mock user for now
    }
    next();
});
// API Routes
server.use('/api/conversations', conversations_1.default);
server.use('/api/personas', personas_1.default);
server.use('/api/models', models_1.default);
server.use('/api/subscription', subscription_1.default);
server.use('/api/search', search_1.default);
server.use('/api/teams', teams_1.default);
server.use('/api/analytics', analytics_1.default);
server.use('/api/collaboration', collaboration_1.default);
server.use('/api/translate', translate_1.default);
// Health check endpoint
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
        const { OpenRouterAdapter } = await Promise.resolve().then(() => __importStar(require('./services/openrouterAdapter')));
        const openRouterAdapter = new OpenRouterAdapter(process.env.OPENROUTER_API_KEY || '', process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1');
        const testMessages = [{ role: 'user', content: 'test' }];
        const options = { model: process.env.OPENROUTER_MODEL || 'gpt-4o-mini', timeout: 10000 };
        const result = await openRouterAdapter.fetchCompletion(testMessages, options);
        res.json({ status: 'success', response: result.substring(0, 100) });
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map