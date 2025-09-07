"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const analyticsService_1 = require("../services/analyticsService");
const teamService_1 = require("../services/teamService");
const conversationService_1 = require("../services/conversationService");
const router = (0, express_1.Router)();
// Get user analytics
router.get('/user', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const analytics = await analyticsService_1.analyticsService.getUserAnalytics(userId);
        res.json(analytics || {});
    }
    catch (error) {
        console.error('Error fetching user analytics:', error);
        res.status(500).json({ error: 'Failed to fetch user analytics' });
    }
});
// Get user usage stats
router.get('/user/usage', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const period = req.query.period || '30d';
        const stats = await analyticsService_1.analyticsService.getUserUsageStats(userId, period);
        res.json(stats);
    }
    catch (error) {
        console.error('Error fetching user usage stats:', error);
        res.status(500).json({ error: 'Failed to fetch user usage stats' });
    }
});
// Get conversation analytics
router.get('/conversations/:id', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // Check if user has access to this conversation
        const conversation = await conversationService_1.conversationService.getConversation(req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        // Check if user owns this conversation or has access
        const hasAccess = await teamService_1.teamService.checkPermission(conversation.user_id, // Using user_id as team_id for individual access
        userId, 'conversation', req.params.id, 'read');
        if (conversation.user_id !== userId && !hasAccess) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const analytics = await analyticsService_1.analyticsService.getConversationAnalytics(req.params.id);
        res.json(analytics || {});
    }
    catch (error) {
        console.error('Error fetching conversation analytics:', error);
        res.status(500).json({ error: 'Failed to fetch conversation analytics' });
    }
});
// Generate conversation insights
router.get('/insights/conversations', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const options = {
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            startDate: req.query.startDate,
            endDate: req.query.endDate
        };
        const insights = await analyticsService_1.analyticsService.generateConversationInsights(userId, options);
        res.json(insights);
    }
    catch (error) {
        console.error('Error generating conversation insights:', error);
        res.status(500).json({ error: 'Failed to generate conversation insights' });
    }
});
// Get team analytics
router.get('/teams/:id', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // Check if user has access to team
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const isMember = members.some(member => member.user_id === userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const analytics = await analyticsService_1.analyticsService.getTeamAnalytics(req.params.id);
        res.json(analytics || {});
    }
    catch (error) {
        console.error('Error fetching team analytics:', error);
        res.status(500).json({ error: 'Failed to fetch team analytics' });
    }
});
// Get team usage stats
router.get('/teams/:id/usage', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // Check if user has access to team
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const isMember = members.some(member => member.user_id === userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const period = req.query.period || '30d';
        const stats = await analyticsService_1.analyticsService.getTeamUsageStats(req.params.id, period);
        res.json(stats);
    }
    catch (error) {
        console.error('Error fetching team usage stats:', error);
        res.status(500).json({ error: 'Failed to fetch team usage stats' });
    }
});
// Generate team insights
router.get('/insights/teams/:id', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // Check if user has access to team
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const isMember = members.some(member => member.user_id === userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const options = {
            limit: req.query.limit ? parseInt(req.query.limit) : undefined
        };
        const insights = await analyticsService_1.analyticsService.generateTeamInsights(req.params.id, options);
        res.json(insights);
    }
    catch (error) {
        console.error('Error generating team insights:', error);
        res.status(500).json({ error: 'Failed to generate team insights' });
    }
});
// Export conversation
router.get('/export/conversations/:id/:format', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { id, format } = req.params;
        if (!['json', 'csv', 'pdf'].includes(format)) {
            return res.status(400).json({ error: 'Invalid format. Supported formats: json, csv, pdf' });
        }
        // Check if user has access to conversation
        const conversation = await conversationService_1.conversationService.getConversation(id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        // Check if user owns this conversation or has access
        const hasAccess = await teamService_1.teamService.checkPermission(conversation.user_id, // Using user_id as team_id for individual access
        userId, 'conversation', id, 'read');
        if (conversation.user_id !== userId && !hasAccess) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const exportData = await analyticsService_1.analyticsService.generateConversationExport(id, format);
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="conversation-${id}.json"`);
            res.json(exportData);
        }
        else if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="conversation-${id}.csv"`);
            res.send(exportData);
        }
        else if (format === 'pdf') {
            // For PDF, we'll return the structured data and let the frontend handle PDF generation
            res.json(exportData);
        }
    }
    catch (error) {
        console.error('Error exporting conversation:', error);
        res.status(500).json({ error: 'Failed to export conversation' });
    }
});
exports.default = router;
//# sourceMappingURL=analytics.js.map