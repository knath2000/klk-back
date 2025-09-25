import { ConversationAnalytics, UserAnalytics, TeamAnalytics } from '../models/analytics';
export declare class AnalyticsService {
    private prisma;
    /**
     * Track conversation analytics
     */
    trackConversationAnalytics(conversationId: string, userId: string, analyticsData: Omit<ConversationAnalytics, 'id' | 'conversation_id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<ConversationAnalytics>;
    /**
     * Get conversation analytics
     */
    getConversationAnalytics(conversationId: string): Promise<ConversationAnalytics | null>;
    /**
     * Track user analytics
     */
    trackUserAnalytics(userId: string, analyticsData: Partial<Omit<UserAnalytics, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<UserAnalytics>;
    /**
     * Get user analytics
     */
    getUserAnalytics(userId: string): Promise<UserAnalytics | null>;
    /**
     * Track team analytics
     */
    trackTeamAnalytics(teamId: string, analyticsData: Partial<Omit<TeamAnalytics, 'id' | 'team_id' | 'created_at' | 'updated_at'>>): Promise<TeamAnalytics>;
    /**
     * Get team analytics
     */
    getTeamAnalytics(teamId: string): Promise<TeamAnalytics | null>;
    /**
     * Get usage statistics for user
     */
    getUserUsageStats(userId: string, period?: string): Promise<any>;
    /**
     * Get team usage statistics
     */
    getTeamUsageStats(teamId: string, period?: string): Promise<any>;
    /**
     * Generate conversation insights report
     */
    generateConversationInsights(userId: string, options?: {
        limit?: number;
        startDate?: string;
        endDate?: string;
    }): Promise<any>;
    /**
     * Generate team insights report
     */
    generateTeamInsights(teamId: string, options?: {
        limit?: number;
    }): Promise<any>;
    /**
     * Generate export data for conversation
     */
    generateConversationExport(conversationId: string, format: 'json' | 'csv' | 'pdf'): Promise<any>;
    /**
     * Generate advanced analytics dashboard data
     */
    generateAdvancedAnalytics(userId: string, options?: {
        period?: string;
        teamId?: string;
        includeTeamData?: boolean;
    }): Promise<any>;
    /**
     * Get team analytics dashboard data
     */
    getTeamAnalyticsDashboard(teamId: string, options?: {
        period?: string;
    }): Promise<any>;
    /**
     * Generate unique ID
     */
    private generateId;
}
export declare const analyticsService: AnalyticsService;
//# sourceMappingURL=analyticsService.d.ts.map