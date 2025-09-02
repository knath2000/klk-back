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
 * GET /api/personas/:id
 * Returns a specific persona by ID
 */
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const persona = personaService_1.personaService.getPersona(id);
        if (!persona) {
            return res.status(404).json({
                error: 'Persona not found',
                code: 'PERSONA_NOT_FOUND'
            });
        }
        res.json({ persona });
    }
    catch (error) {
        console.error('Error fetching persona:', error);
        res.status(500).json({
            error: 'Internal server error',
            code: 'INTERNAL_ERROR'
        });
    }
});
exports.default = router;
//# sourceMappingURL=personas.js.map