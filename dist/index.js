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
//# sourceMappingURL=index.js.map