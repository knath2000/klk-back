"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const personaService_1 = require("../services/personaService");
const router = (0, express_1.Router)();
// Add CORS headers to all persona routes
router.use((req, res, next) => {
    const allowedOrigins = process.env.FRONTEND_URL ?
        process.env.FRONTEND_URL.split(',').map(url => url.trim()) :
        ["http://localhost:3000", "https://klk-front.vercel.app"];
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
});
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
exports.default = router;
//# sourceMappingURL=personas.js.map