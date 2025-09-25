"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsService = exports.AnalyticsService = void 0;
const client_1 = require("@prisma/client");
class AnalyticsService {
    constructor() {
        this.prisma = new client_1.PrismaClient();
    }
    /**
     * Track conversation analytics
     */
    async trackConversationAnalytics(conversationId, userId, analyticsData) {
        const now = new Date();
        const row = await this.prisma.conversationAnalytics.upsert({
            where: { conversation_id: conversationId },
            update: { ...analyticsData, updated_at: now },
            create: {
                conversation_id: conversationId,
                user_id: userId,
                ...analyticsData,
                created_at: now,
                updated_at: now
            }
        });
        return row;
    }
    /**
     * Get conversation analytics
     */
    async getConversationAnalytics(conversationId) {
        const row = await this.prisma.conversationAnalytics.findUnique({
            where: { conversation_id: conversationId }
        });
        return row ?? null;
    }
    /**
     * Track user analytics
     */
    async trackUserAnalytics(userId, analyticsData) {
        const now = new Date();
        const row = await this.prisma.userAnalytics.upsert({
            where: { user_id: userId },
            update: { ...analyticsData, updated_at: now },
            create: {
                user_id: userId,
                total_conversations: analyticsData?.total_conversations ?? 0,
                total_messages: analyticsData?.total_messages ?? 0,
                total_tokens: analyticsData?.total_tokens ?? 0,
                avg_response_time: analyticsData?.avg_response_time ?? 0,
                created_at: now,
                updated_at: now
            }
        });
        return row;
    }
    /**
     * Get user analytics
     */
    async getUserAnalytics(userId) {
        const row = await this.prisma.userAnalytics.findUnique({
            where: { user_id: userId }
        });
        return row ?? null;
    }
    /**
     * Track team analytics
     */
    async trackTeamAnalytics(teamId, analyticsData) {
        const now = new Date();
        const row = await this.prisma.teamAnalytics.upsert({
            where: { team_id: teamId },
            update: { ...analyticsData, updated_at: now },
            create: {
                team_id: teamId,
                total_conversations: analyticsData?.total_conversations ?? 0,
                total_messages: analyticsData?.total_messages ?? 0,
                token_usage: analyticsData?.total_tokens ?? 0,
                created_at: now,
                updated_at: now
            }
        });
        return row;
    }
    /**
     * Get team analytics
     */
    async getTeamAnalytics(teamId) {
        const row = await this.prisma.teamAnalytics.findUnique({
            where: { team_id: teamId }
        });
        return row ?? null;
    }
    /**
     * Get usage statistics for user
     */
    async getUserUsageStats(userId, period = '30d') {
        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(period.replace('d', '')));
        const conversations = await this.prisma.conversation.findMany({
            where: {
                user_id: userId,
                created_at: { gte: startDate, lte: endDate }
            },
            select: { id: true, created_at: true, message_count: true, model: true }
        });
        // Get message count
        const totalConversations = conversations.length;
        const totalMessages = conversations.reduce((sum, conv) => sum + conv.message_count, 0);
        const usage = await this.prisma.usageLog.findMany({
            where: {
                user_id: userId,
                created_at: { gte: new Date(`${startDate.toISOString().slice(0, 7)}-01`) }
            },
            select: { tokens_used: true }
        });
        const totalTokens = usage.reduce((sum, log) => sum + log.tokens_used, 0);
        return {
            totalConversations,
            totalMessages,
            totalTokens,
            period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
        };
    }
    /**
     * Get team usage statistics
     */
    async getTeamUsageStats(teamId, period = '30d') {
        // Get team members
        const members = await this.prisma.teamMember.findMany({
            where: { team_id: teamId, is_active: true },
            select: { user_id: true }
        });
        // Get team conversations
        const conversations = await this.prisma.conversation.findMany({
            where: { team_id: teamId },
            select: { id: true, user_id: true, message_count: true }
        });
        const userIds = members.map((m) => m.user_id);
        const totalConversations = conversations.length;
        const totalMessages = conversations.reduce((sum, conv) => sum + conv.message_count, 0);
        // Get token usage for team members
        let totalTokens = 0;
        for (const userId of userIds) {
            const usage = await this.prisma.usageLog.findMany({
                where: { user_id: userId },
                select: { tokens_used: true }
            });
            totalTokens += usage.reduce((sum, log) => sum + log.tokens_used, 0);
        }
        return {
            totalConversations,
            totalMessages,
            totalTokens,
            activeMembers: userIds.length
        };
    }
    /**
     * Generate conversation insights report
     */
    async generateConversationInsights(userId, options = {}) {
        const limit = options.limit || 10;
        const startDate = options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = options.endDate || new Date().toISOString();
        // Get top conversations by message count
        const topConversations = await this.prisma.conversation.findMany({
            where: {
                user_id: userId,
                created_at: { gte: new Date(startDate), lte: new Date(endDate) }
            },
            orderBy: { message_count: 'desc' },
            take: limit
        });
        // Get model usage distribution (simplified approach)
        const modelUsage = {};
        for (const conv of topConversations) {
            modelUsage[conv.model] = (modelUsage[conv.model] || 0) + 1;
        }
        // Get conversation analytics
        const analyticsRows = await this.prisma.conversationAnalytics.findMany({
            where: { conversation_id: { in: topConversations.map((c) => c.id) } }
        });
        const analyticsByConv = new Map(analyticsRows.map((a) => [a.conversation_id, a]));
        return {
            topConversations: topConversations.map((conv, index) => ({
                ...conv,
                analytics: analyticsByConv.get(conv.id) ?? null
            })),
            modelUsage,
            totalConversations: topConversations.length,
            dateRange: { startDate, endDate }
        };
    }
    /**
     * Generate team insights report
     */
    async generateTeamInsights(teamId, options = {}) {
        const limit = options.limit || 10;
        // Get team conversations
        const conversations = await this.prisma.conversation.findMany({
            where: { team_id: teamId },
            orderBy: { updated_at: 'desc' },
            take: limit
        });
        // Get team members activity
        const members = await this.prisma.teamMember.findMany({
            where: { team_id: teamId, is_active: true },
            select: { user_id: true }
        });
        // Get conversation analytics for team conversations
        const analytics = await this.prisma.conversationAnalytics.findMany({
            where: { conversation_id: { in: conversations.map((c) => c.id) } }
        });
        const byConv = new Map(analytics.map(a => [a.conversation_id, a]));
        return {
            teamConversations: conversations.map((conv, index) => ({
                ...conv,
                analytics: byConv.get(conv.id) ?? null
            })),
            teamMembers: members,
            totalConversations: conversations.length,
            activeMembers: members.length
        };
    }
    /**
     * Generate export data for conversation
     */
    async generateConversationExport(conversationId, format) {
        // Get conversation details
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId }
        });
        if (!conversation) {
            throw new Error('Failed to fetch conversation');
        }
        // Get conversation messages
        const messages = await this.prisma.conversationMessage.findMany({
            where: { conversation_id: conversationId },
            orderBy: { created_at: 'asc' }
        });
        // Get conversation analytics
        const analytics = await this.prisma.conversationAnalytics.findUnique({
            where: { conversation_id: conversationId }
        });
        const exportData = {
            conversation: {
                id: conversation.id,
                title: conversation.title,
                model: conversation.model,
                created_at: conversation.created_at,
                updated_at: conversation.updated_at,
                message_count: conversation.message_count
            },
            messages: messages.map((msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                model: msg.model,
                created_at: msg.created_at,
                tokens_used: msg.tokens_used
            })),
            analytics,
            exported_at: new Date().toISOString()
        };
        if (format === 'json') {
            return exportData;
        }
        else if (format === 'csv') {
            // Convert to CSV format
            const csvHeaders = ['Role', 'Content', 'Model', 'Created At', 'Tokens Used'];
            const csvRows = messages.map((msg) => [
                String(msg.role),
                `"${String(msg.content).replace(/"/g, '""')}"`,
                String(msg.model ?? ''),
                String(msg.created_at ?? ''),
                String(msg.tokens_used ?? '')
            ]);
            const csvContent = [csvHeaders.join(','), ...csvRows.map((row) => row.join(','))].join('\n');
            return csvContent;
        }
        else if (format === 'pdf') {
            // Return structured data for PDF generation
            return exportData;
        }
        return exportData;
    }
    /**
     * Generate advanced analytics dashboard data
     */
    async generateAdvancedAnalytics(userId, options = {}) {
        const period = options.period || '30d';
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(period.replace('d', '')));
        let conversationsQuery;
        if (options.teamId) {
            conversationsQuery = this.prisma.conversation.findMany({
                where: {
                    team_id: options.teamId,
                    created_at: { gte: startDate, lte: endDate }
                }
            });
        }
        else {
            conversationsQuery = this.prisma.conversation.findMany({
                where: {
                    user_id: userId,
                    created_at: { gte: startDate, lte: endDate }
                }
            });
        }
        const conversations = await conversationsQuery;
        // Get usage logs
        const usageLogs = await this.prisma.usageLog.findMany({
            where: {
                user_id: userId,
                created_at: { gte: new Date(startDate.toISOString().slice(0, 10)) }
            }
        });
        // Calculate metrics
        const totalConversations = conversations.length;
        const totalMessages = conversations.reduce((sum, conv) => sum + conv.message_count, 0);
        const totalTokens = usageLogs.reduce((sum, log) => sum + log.tokens_used, 0);
        // Model usage breakdown
        const modelUsage = {};
        conversations.forEach((conv) => {
            if (conv.model) {
                if (!modelUsage[conv.model]) {
                    modelUsage[conv.model] = { count: 0, tokens: 0 };
                }
                modelUsage[conv.model].count += 1;
            }
        });
        // Daily usage trends
        const dailyUsage = {};
        conversations.forEach((conv) => {
            const date = conv.created_at.split('T')[0];
            if (date) {
                if (!dailyUsage[date]) {
                    dailyUsage[date] = { conversations: 0, messages: 0, tokens: 0 };
                }
                dailyUsage[date].conversations += 1;
                dailyUsage[date].messages += conv.message_count;
            }
        });
        // Top conversations by message count
        const topConversations = [...conversations]
            .sort((a, b) => b.message_count - a.message_count)
            .slice(0, 10);
        return {
            summary: {
                totalConversations,
                totalMessages,
                totalTokens,
                period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
            },
            modelUsage,
            dailyUsage,
            topConversations: topConversations.map((conv, index) => ({
                id: conv.id,
                title: conv.title,
                message_count: conv.message_count,
                model: conv.model,
                created_at: conv.created_at
            })),
            usageTrends: {
                conversations: Object.keys(dailyUsage).length,
                messages: totalMessages,
                tokens: totalTokens
            }
        };
    }
    /**
     * Get team analytics dashboard data
     */
    async getTeamAnalyticsDashboard(teamId, options = {}) {
        const period = options.period || '30d';
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(period.replace('d', '')));
        // Get team members
        const members = await this.prisma.teamMember.findMany({
            where: { team_id: teamId, is_active: true },
            select: { user_id: true }
        });
        // Get team conversations
        const conversations = await this.prisma.conversation.findMany({
            where: {
                team_id: teamId,
                created_at: { gte: startDate, lte: endDate }
            }
        });
        // Get team analytics
        const teamAnalytics = await this.prisma.teamAnalytics.findUnique({
            where: { team_id: teamId }
        });
        // Calculate team metrics
        const totalConversations = conversations.length;
        const totalMessages = conversations.reduce((sum, conv) => sum + conv.message_count, 0);
        // Member activity
        const memberActivity = {};
        const userIds = members.map((m) => m.user_id);
        for (const userId of userIds) {
            const userConversations = conversations.filter((conv) => conv.user_id === userId);
            memberActivity[userId] = {
                conversations: userConversations.length,
                messages: userConversations.reduce((sum, conv) => sum + conv.message_count, 0)
            };
        }
        // Top active members
        const topMembers = Object.entries(memberActivity)
            .map(([userId, activity]) => ({
            userId,
            ...activity,
            name: `User ${userId.substring(0, 8)}` // Simplified name
        }))
            .sort((a, b) => b.messages - a.messages)
            .slice(0, 10);
        return {
            team: teamAnalytics,
            summary: {
                totalConversations,
                totalMessages,
                activeMembers: userIds.length,
                period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
            },
            memberActivity,
            topMembers,
            recentConversations: conversations
                .sort((a, b) => new Date(b.updated_at || '1970-01-01T00:00:00Z').getTime() - new Date(a.updated_at || '1970-01-01T00:00:00Z').getTime())
                .slice(0, 10)
        };
    }
    /**
     * Generate unique ID
     */
    generateId() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
}
exports.AnalyticsService = AnalyticsService;
// Export singleton instance
exports.analyticsService = new AnalyticsService();
//# sourceMappingURL=analyticsService.js.map