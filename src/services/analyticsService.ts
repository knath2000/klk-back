import { getSupabase } from './db';
import { ConversationAnalytics, UserAnalytics, TeamAnalytics } from '../models/analytics';

export class AnalyticsService {
  /**
   * Track conversation analytics
   */
  async trackConversationAnalytics(conversationId: string, userId: string, analyticsData: Omit<ConversationAnalytics, 'id' | 'conversation_id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<ConversationAnalytics> {
    const supabase = getSupabase();
    
    const conversationAnalytics: any = {
      id: this.generateId(),
      conversation_id: conversationId,
      user_id: userId,
      ...analyticsData,
      created_at: new Date(),
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('conversation_analytics')
      .upsert(conversationAnalytics, { onConflict: 'conversation_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to track conversation analytics: ${error.message}`);
    }

    return data;
  }

  /**
   * Get conversation analytics
   */
  async getConversationAnalytics(conversationId: string): Promise<ConversationAnalytics | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('conversation_analytics')
      .select('*')
      .eq('conversation_id', conversationId)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  /**
   * Track user analytics
   */
  async trackUserAnalytics(userId: string, analyticsData: Partial<Omit<UserAnalytics, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<UserAnalytics> {
    const supabase = getSupabase();
    
    const userAnalytics: any = {
      user_id: userId,
      ...analyticsData,
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('user_analytics')
      .upsert(userAnalytics, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to track user analytics: ${error.message}`);
    }

    return data;
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(userId: string): Promise<UserAnalytics | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_analytics')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  /**
   * Track team analytics
   */
  async trackTeamAnalytics(teamId: string, analyticsData: Partial<Omit<TeamAnalytics, 'id' | 'team_id' | 'created_at' | 'updated_at'>>): Promise<TeamAnalytics> {
    const supabase = getSupabase();
    
    const teamAnalytics: any = {
      team_id: teamId,
      ...analyticsData,
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('team_analytics')
      .upsert(teamAnalytics, { onConflict: 'team_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to track team analytics: ${error.message}`);
    }

    return data;
  }

  /**
   * Get team analytics
   */
  async getTeamAnalytics(teamId: string): Promise<TeamAnalytics | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('team_analytics')
      .select('*')
      .eq('team_id', teamId)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  /**
   * Get usage statistics for user
   */
  async getUserUsageStats(userId: string, period: string = '30d'): Promise<any> {
    const supabase = getSupabase();
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period.replace('d', '')));

    // Get conversation count
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select('id, created_at, message_count')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (convError) {
      throw new Error(`Failed to fetch conversation stats: ${convError.message}`);
    }

    // Get message count
    const totalConversations = conversations.length;
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.message_count, 0);

    // Get token usage
    const { data: usage, error: usageError } = await supabase
      .from('usage_logs')
      .select('tokens_used')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString().slice(0, 7) + '-01');

    if (usageError) {
      throw new Error(`Failed to fetch usage stats: ${usageError.message}`);
    }

    const totalTokens = usage ? usage.reduce((sum, log) => sum + log.tokens_used, 0) : 0;

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
    const supabase = getSupabase();
    
    // Get team members
    const { data: members, error: membersError } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .eq('is_active', true);

    if (membersError) {
      throw new Error(`Failed to fetch team members: ${membersError.message}`);
    }

    const userIds = members.map(m => m.user_id);
    
    // Get team conversations
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select('id, user_id, message_count')
      .eq('team_id', teamId);

    if (convError) {
      throw new Error(`Failed to fetch team conversations: ${convError.message}`);
    }

    const totalConversations = conversations.length;
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.message_count, 0);

    // Get token usage for team members
    let totalTokens = 0;
    for (const userId of userIds) {
      const { data: usage } = await supabase
        .from('usage_logs')
        .select('tokens_used')
        .eq('user_id', userId);
      
      if (usage) {
        totalTokens += usage.reduce((sum, log) => sum + log.tokens_used, 0);
      }
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
    const supabase = getSupabase();
    
    const limit = options.limit || 10;
    const startDate = options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = options.endDate || new Date().toISOString();

    // Get top conversations by message count
    const { data: topConversations, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('message_count', { ascending: false })
      .limit(limit);

    if (convError) {
      throw new Error(`Failed to fetch top conversations: ${convError.message}`);
    }

    // Get model usage distribution (simplified approach)
    const modelUsage: Record<string, number> = {};
    for (const conv of topConversations) {
      modelUsage[conv.model] = (modelUsage[conv.model] || 0) + 1;
    }

    // Get conversation analytics
    const analyticsPromises = topConversations.map(conv => 
      this.getConversationAnalytics(conv.id)
    );
    
    const analytics = await Promise.all(analyticsPromises);

    return {
      topConversations: topConversations.map((conv, index) => ({
        ...conv,
        analytics: analytics[index]
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
    const supabase = getSupabase();
    
    const limit = options.limit || 10;

    // Get team conversations
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('team_id', teamId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (convError) {
      throw new Error(`Failed to fetch team conversations: ${convError.message}`);
    }

    // Get team members activity
    const { data: members, error: membersError } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .eq('is_active', true);

    if (membersError) {
      throw new Error(`Failed to fetch team members: ${membersError.message}`);
    }

    // Get conversation analytics for team conversations
    const analyticsPromises = conversations.map(conv => 
      this.getConversationAnalytics(conv.id)
    );
    
    const analytics = await Promise.all(analyticsPromises);

    return {
      teamConversations: conversations.map((conv, index) => ({
        ...conv,
        analytics: analytics[index]
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
    const supabase = getSupabase();
    
    // Get conversation details
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (convError) {
      throw new Error(`Failed to fetch conversation: ${convError.message}`);
    }

    // Get conversation messages
    const { data: messages, error: msgError } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (msgError) {
      throw new Error(`Failed to fetch conversation messages: ${msgError.message}`);
    }

    // Get conversation analytics
    const analytics = await this.getConversationAnalytics(conversationId);

    const exportData = {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        model: conversation.model,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        message_count: conversation.message_count
      },
      messages: messages.map(msg => ({
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
    } else if (format === 'csv') {
      // Convert to CSV format
      const csvHeaders = ['Role', 'Content', 'Model', 'Created At', 'Tokens Used'];
      const csvRows = messages.map(msg => [
        msg.role,
        `"${msg.content.replace(/"/g, '""')}"`,
        msg.model,
        msg.created_at,
        msg.tokens_used || ''
      ]);
      
      const csvContent = [csvHeaders.join(','), ...csvRows.map(row => row.join(','))].join('\n');
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
    const supabase = getSupabase();
    
    const period = options.period || '30d';
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period.replace('d', '')));

    let conversationsQuery;
    if (options.teamId) {
      conversationsQuery = supabase
        .from('conversations')
        .select('*')
        .eq('team_id', options.teamId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());
    } else {
      conversationsQuery = supabase
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());
    }

    const { data: conversations, error: convError } = await conversationsQuery;

    if (convError) {
      throw new Error(`Failed to fetch conversations: ${convError.message}`);
    }

    // Get usage logs
    const { data: usageLogs, error: usageError } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString().slice(0, 10));

    if (usageError) {
      throw new Error(`Failed to fetch usage logs: ${usageError.message}`);
    }

    // Calculate metrics
    const totalConversations = conversations.length;
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.message_count, 0);
    const totalTokens = usageLogs.reduce((sum, log) => sum + log.tokens_used, 0);
    
    // Model usage breakdown
    const modelUsage: Record<string, { count: number, tokens: number }> = {};
    conversations.forEach(conv => {
      if (!modelUsage[conv.model]) {
        modelUsage[conv.model] = { count: 0, tokens: 0 };
      }
      modelUsage[conv.model].count += 1;
    });

    // Daily usage trends
    const dailyUsage: Record<string, { conversations: number, messages: number, tokens: number }> = {};
    conversations.forEach(conv => {
      const date = conv.created_at.split('T')[0];
      if (!dailyUsage[date]) {
        dailyUsage[date] = { conversations: 0, messages: 0, tokens: 0 };
      }
      dailyUsage[date].conversations += 1;
      dailyUsage[date].messages += conv.message_count;
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
      topConversations: topConversations.map(conv => ({
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
  async getTeamAnalyticsDashboard(teamId: string, options: { period?: string } = {}): Promise<any> {
    const supabase = getSupabase();
    
    const period = options.period || '30d';
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period.replace('d', '')));

    // Get team members
    const { data: members, error: membersError } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .eq('is_active', true);

    if (membersError) {
      throw new Error(`Failed to fetch team members: ${membersError.message}`);
    }

    // Get team conversations
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('team_id', teamId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (convError) {
      throw new Error(`Failed to fetch team conversations: ${convError.message}`);
    }

    // Get team analytics
    const teamAnalytics = await this.getTeamAnalytics(teamId);

    // Calculate team metrics
    const totalConversations = conversations.length;
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.message_count, 0);
    
    // Member activity
    const memberActivity: Record<string, { conversations: number, messages: number }> = {};
    const userIds = members.map(m => m.user_id);
    
    for (const userId of userIds) {
      const userConversations = conversations.filter(conv => conv.user_id === userId);
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
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
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