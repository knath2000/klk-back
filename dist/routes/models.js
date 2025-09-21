"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const conversationService_1 = require("../services/conversationService");
const router = (0, express_1.Router)();
router.post('/:id/switch', async (req, res) => {
    const { id } = req.params;
    const { conversationId } = req.body;
    if (!conversationId) {
        return res.status(400).json({ error: 'Conversation ID is required' });
    }
    try {
        await conversationService_1.conversationService.switchModel(conversationId, id);
        res.json({ success: true, message: 'Model switched successfully' });
    }
    catch (error) {
        console.error('Error switching model:', error);
        res.status(500).json({ error: 'Failed to switch model' });
    }
});
exports.default = router;
//# sourceMappingURL=models.js.map