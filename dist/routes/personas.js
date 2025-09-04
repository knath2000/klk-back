"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const personaService_1 = require("../services/personaService");
const router = (0, express_1.Router)();
/**
 * GET /api/personas
 * Returns the list of available personas for the client
 */
router.get('/', (req, res) => {
    try {
        const personas = personaService_1.personaService.getAllPersonas();
        // Add CORS headers to response
        res.setHeader('Content-Type', 'application/json');
        res.json({
            personas
        });
    }
    catch (error) {
        console.error('Error fetching personas:', error);
        res.status(500).json({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR'
        });
    }
});
/**
 * GET /api/personas/debug
 * Returns debug information about the server and personas
 */
router.get('/debug', (req, res) => {
    try {
        const debugInfo = {
            timestamp: new Date().toISOString(),
            server: {
                nodeVersion: process.version,
                environment: process.env.NODE_ENV || 'development',
                platform: process.platform,
                uptime: process.uptime(),
                memory: process.memoryUsage()
            },
            request: {
                origin: req.headers.origin,
                userAgent: req.headers['user-agent'],
                method: req.method,
                path: req.path,
                query: req.query,
                ip: req.ip
            },
            cors: {
                allowedOrigins: process.env.FRONTEND_URL ?
                    process.env.FRONTEND_URL.split(',').map(url => url.trim()) :
                    ["http://localhost:3000", "https://klk-front.vercel.app"],
                requestOrigin: req.headers.origin
            },
            personas: {
                count: personaService_1.personaService.getAllPersonas().length,
                data: personaService_1.personaService.getAllPersonas().map(p => ({
                    id: p.id,
                    country_key: p.country_key,
                    displayName: p.displayName,
                    safe_reviewed: p.safe_reviewed
                }))
            }
        };
        res.setHeader('Content-Type', 'application/json');
        res.json(debugInfo);
    }
    catch (error) {
        console.error('Error in debug endpoint:', error);
        res.status(500).json({
            error: 'Debug endpoint error',
            code: 'DEBUG_ERROR',
            timestamp: new Date().toISOString()
        });
    }
});
/**
 * GET /api/personas/ping
 * Simple connectivity test endpoint
 */
router.get('/ping', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
        status: 'pong',
        timestamp: new Date().toISOString(),
        server: 'personas-api',
        version: '1.0.0'
    });
});
exports.default = router;
//# sourceMappingURL=personas.js.map