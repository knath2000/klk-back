import { ConversationAnalytics, UserAnalytics, TeamAnalytics } from '../models/analytics';
import { PrismaClient } from '@prisma/client';

// Add interfaces at the top after imports (align with Prisma models: dates are Date)
interface ConversationSummary {
  id: string;
  message_count: number;
  user_id?: string;
  title?: string;
  updated_at?: Date;
  model?: string;
  created_at?: Date;
}

interface UsageLog {
  tokens_used: number;
}

interface TeamMember {
  user_id: string;
}

interface MessageSummary {
  id: string;
  content: string;
  created_at: Date;
  role: string;
  model?: string;
  tokens_used?: number | null;
}

export class AnalyticsService {
  private prisma = new PrismaClient();
  /**
   * Track conversation analytics
   */
  async trackConversationAnalytics(conversationId: string, userId: string, analyticsData: Omit<ConversationAnalytics, 'id' | 'conversation_id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<ConversationAnalytics> {
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
    return row as unknown as ConversationAnalytics;
  }

  /**
   * Get conversation analytics
   */
  async getConversationAnalytics(conversationId: string): Promise<ConversationAnalytics | null> {
    const row = await this.prisma.conversationAnalytics.findUnique({
      where: { conversation_id: conversationId }
    });
    return (row as unknown as ConversationAnalytics) ?? null;
  }

  /**
   * Track user analytics
   */
  async trackUserAnalytics(userId: string, analyticsData: Partial<Omit<UserAnalytics, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<UserAnalytics> {
    const now = new Date();
    const row = await this.prisma.userAnalytics.upsert({
      where: { user_id: userId },
      update: { ...analyticsData, updated_at: now },
      create: {
        user_id: userId,
        total_conversations: analyticsData?.total_conversations ?? 0,
        total_messages: analyticsData?.total_messages ?? 0,
        total_tokens: analyticsData?.total_tokens ?? 0,
        avg_response_time: (analyticsData as any)?.avg_response_time ?? 0,
        created_at: now,
        updated_at: now
      }
    });
    return row as unknown as UserAnalytics;
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(userId: string): Promise<UserAnalytics | null> {
    const row = await this.prisma.userAnalytics.findUnique({
      where: { user_id: userId }
    });
    return (row as unknown as UserAnalytics) ?? null;
  }

  /**
   * Track team analytics
   */
  async trackTeamAnalytics(teamId: string, analyticsData: Partial<Omit<TeamAnalytics, 'id' | 'team_id' | 'created_at' | 'updated_at'>>): Promise<TeamAnalytics> {
    const now = new Date();
    const row = await this.prisma.teamAnalytics.upsert({
      where: { team_id: teamId },
      update: { ...analyticsData, updated_at: now },
      create: {
        team_id: teamId,
        total_conversations: analyticsData?.total_conversations ?? 0,
        total_messages: analyticsData?.total_messages ?? 0,
        token_usage: (analyticsData as any)?.total_tokens ?? 0,
        created_at: now,
        updated_at: now
      }
    });
    return row as unknown as TeamAnalytics;
  }

  /**
   * Get team analytics
   */
  async getTeamAnalytics(teamId: string): Promise<TeamAnalytics | null> {
    const row = await this.prisma.teamAnalytics.findUnique({
      where: { team_id: teamId }
    });
    return (row as unknown as TeamAnalytics) ?? null;
  }

  /**
   * Get usage statistics for user
   */
  async getUserUsageStats(userId: string, period: string = '30d'): Promise<any> {
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
    const totalMessages = conversations.reduce((sum: number, conv: ConversationSummary) => sum + (conv as any).message_count, 0);

    const usage = await this.prisma.usageLog.findMany({
      where: {
        user_id: userId,
        created_at: { gte: new Date(`${startDate.toISOString().slice(0,7)}-01`) }
      },
      select: { tokens_used: true }
    });
    const totalTokens = usage.reduce((sum: number, log: UsageLog) => sum + (log as any).tokens_used, 0);

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
  async getTeamUsageStats(teamId: string, period: string = '30d'): Promise<any> {
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

    const userIds = members.map((m: TeamMember) => m.user_id);
    
    const totalConversations = conversations.length;
    const totalMessages = conversations.reduce((sum: number, conv: ConversationSummary) => sum + (conv as any).message_count, 0);

    // Get token usage for team members
    let totalTokens = 0;
    for (const userId of userIds) {
      const usage = await this.prisma.usageLog.findMany({
        where: { user_id: userId },
        select: { tokens_used: true }
      });
      totalTokens += usage.reduce((sum: number, log: UsageLog) => sum + (log as any).tokens_used, 0);
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
  async generateConversationInsights(userId: string, options: { limit?: number, startDate?: string, endDate?: string } = {}): Promise<any> {
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
    const modelUsage: Record<string, number> = {};
    for (const conv of topConversations) {
      modelUsage[conv.model] = (modelUsage[conv.model] || 0) + 1;
    }

    // Get conversation analytics
    const analyticsRows = await this.prisma.conversationAnalytics.findMany({
      where: { conversation_id: { in: topConversations.map((c: any) => c.id) } }
    });
    const analyticsByConv = new Map(analyticsRows.map((a) => [a.conversation_id, a]));

    return {
      topConversations: topConversations.map((conv: ConversationSummary, index: number) => ({
        ...conv,
        analytics: analyticsByConv.get((conv as any).id) ?? null
      })),
      modelUsage,
      totalConversations: topConversations.length,
      dateRange: { startDate, endDate }
    };
  }

  /**
   * Generate team insights report
   */
  async generateTeamInsights(teamId: string, options: { limit?: number } = {}): Promise<any> {
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
      where: { conversation_id: { in: (conversations as any[]).map((c) => c.id) } }
    });
    const byConv = new Map(analytics.map(a => [a.conversation_id, a]));

    return {
      teamConversations: conversations.map((conv: ConversationSummary, index: number) => ({
        ...conv,
        analytics: byConv.get((conv as any).id) ?? null
      })),
      teamMembers: members,
      totalConversations: conversations.length,
      activeMembers: members.length
    };
  }

  /**
   * Generate export data for conversation
   */
  async generateConversationExport(conversationId: string, format: 'json' | 'csv' | 'pdf'): Promise<any> {
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
        title: (conversation as any).title,
        model: (conversation as any).model,
        created_at: (conversation as any).created_at,
        updated_at: (conversation as any).updated_at,
        message_count: (conversation as any).message_count
      },
      messages: messages.map((msg) => ({
        id: msg.id,
        role: (msg as any).role,
        content: (msg as any).content,
        model: (msg as any).model,
        created_at: (msg as any).created_at,
        tokens_used: (msg as any).tokens_used
      })),
      analytics,
      exported_at: new Date().toISOString()
    };

    if (format === 'json') {
      return exportData;
    } else if (format === 'csv') {
      // Convert to CSV format
      const csvHeaders = ['Role', 'Content', 'Model', 'Created At', 'Tokens Used'];
      const csvRows = messages.map((msg) => [
        String((msg as any).role),
        `"${String((msg as any).content).replace(/"/g, '""')}"`,
        String((msg as any).model ?? ''),
        String((msg as any).created_at ?? ''),
        String((msg as any).tokens_used ?? '')
      ]);
      
      const csvContent = [csvHeaders.join(','), ...csvRows.map((row: string[]) => row.join(','))].join('\n');
      return csvContent;
    } else if (format === 'pdf') {
      // Return structured data for PDF generation
      return exportData;
    }

    return exportData;
  }

  /**
   * Generate advanced analytics dashboard data
   */
  async generateAdvancedAnalytics(userId: string, options: { 
    period?: string, 
    teamId?: string,
    includeTeamData?: boolean 
  } = {}): Promise<any> {
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
    } else {
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
    const totalMessages = conversations.reduce((sum: number, conv: ConversationSummary) => sum + (conv as any).message_count, 0);
    const totalTokens = (usageLogs as any[]).reduce((sum: number, log: UsageLog) => sum + log.tokens_used, 0);
    
    // Model usage breakdown
    const modelUsage: Record<string, { count: number, tokens: number }> = {};
    conversations.forEach((conv: ConversationSummary) => {
      if (conv.model) {
        if (!modelUsage[conv.model]) {
          modelUsage[conv.model] = { count: 0, tokens: 0 };
        }
        modelUsage[conv.model].count += 1;
      }
    });

    // Daily usage trends
    const dailyUsage: Record<string, { conversations: number, messages: number, tokens: number }> = {};
    conversations.forEach((conv: ConversationSummary) => {
      const date = (conv as any).created_at.split('T')[0];
      if (date) {
        if (!dailyUsage[date]) {
          dailyUsage[date] = { conversations: 0, messages: 0, tokens: 0 };
        }
        dailyUsage[date].conversations += 1;
        dailyUsage[date].messages += (conv as any).message_count;
      }
    });

    // Top conversations by message count
    const topConversations = [...conversations]
      .sort((a: ConversationSummary, b: ConversationSummary) => (b as any).message_count - (a as any).message_count)
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
      topConversations: topConversations.map((conv: ConversationSummary, index: number) => ({
        id: (conv as any).id,
        title: (conv as any).title,
        message_count: (conv as any).message_count,
        model: (conv as any).model,
        created_at: (conv as any).created_at
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
  async getTeamAnalyticsDashboard(teamId: string, options: { period?: string } = {}): Promise<any> {
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
    const totalMessages = conversations.reduce((sum: number, conv: ConversationSummary) => sum + (conv as any).message_count, 0);
    
    // Member activity
    const memberActivity: Record<string, { conversations: number, messages: number }> = {};
    const userIds = members.map((m: TeamMember) => m.user_id);
    
    for (const userId of userIds) {
      const userConversations = (conversations as any[]).filter((conv: ConversationSummary) => conv.user_id === userId);
      memberActivity[userId] = {
        conversations: userConversations.length,
        messages: userConversations.reduce((sum: number, conv: ConversationSummary) => sum + (conv as any).message_count, 0)
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
      recentConversations: (conversations as any[])
        .sort((a: ConversationSummary, b: ConversationSummary) => new Date((b as any).updated_at || '1970-01-01T00:00:00Z').getTime() - new Date((a as any).updated_at || '1970-01-01T00:00:00Z').getTime())
        .slice(0, 10)
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();