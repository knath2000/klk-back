"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const conversationService_1 = require("../services/conversationService");
const searchService_1 = require("../services/searchService");
const router = (0, express_1.Router)();
// Get user's conversations
router.get('/', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const conversations = await conversationService_1.conversationService.getUserConversations(userId);
        res.json(conversations);
    }
    catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});
// Create new conversation
router.post('/', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { title, model, persona_id } = req.body;
        const conversation = await conversationService_1.conversationService.createConversation({
            user_id: userId,
            title: title || 'New Conversation',
            model: model || 'gpt-4o-mini',
            persona_id
        }); // Type assertion to bypass strict typing for now
        res.status(201).json(conversation);
    }
    catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({ error: 'Failed to create conversation' });
    }
});
// Get conversation by ID
router.get('/:id', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const conversation = await conversationService_1.conversationService.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        // Check if user owns this conversation
        if (conversation.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json(conversation);
    }
    catch (error) {
        console.error('Error fetching conversation:', error);
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});
// Update conversation
router.put('/:id', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const conversation = await conversationService_1.conversationService.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        // Check if user owns this conversation
        if (conversation.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const updatedConversation = await conversationService_1.conversationService.updateConversation(req.params.id, req.body);
        res.json(updatedConversation);
    }
    catch (error) {
        console.error('Error updating conversation:', error);
        res.status(500).json({ error: 'Failed to update conversation' });
    }
});
// Delete conversation
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const conversation = await conversationService_1.conversationService.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        // Check if user owns this conversation
        if (conversation.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        await conversationService_1.conversationService.deleteConversation(req.params.id);
        res.status(204).send();
    }
    catch (error) {
        console.error('Error deleting conversation:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});
// Sync conversation metadata
router.post('/:id/sync', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const conversation = await conversationService_1.conversationService.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        // Check if user owns this conversation
        if (conversation.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { title, messageCount, lastMessageAt } = req.body;
        await conversationService_1.conversationService.syncConversationMetadata(req.params.id, {
            title,
            messageCount,
            lastMessageAt: new Date(lastMessageAt)
        });
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error syncing conversation:', error);
        res.status(500).json({ error: 'Failed to sync conversation' });
    }
});
// Search conversations
router.get('/search/:query', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const conversations = await searchService_1.searchService.searchConversations(userId, req.params.query);
        res.json(conversations);
    }
    catch (error) {
        console.error('Error searching conversations:', error);
        res.status(500).json({ error: 'Failed to search conversations' });
    }
});
exports.default = router;
//# sourceMappingURL=conversations.js.map