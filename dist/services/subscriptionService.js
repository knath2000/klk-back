"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionService = exports.SubscriptionService = void 0;
const db_1 = require("./db");
class SubscriptionService {
    constructor() {
        this.subscriptionPlans = [
            {
                id: 'free',
                name: 'Free',
                description: 'Basic access to the chat assistant',
                price_monthly: 0,
                price_yearly: 0,
                features: [
                    '3 conversations per day',
                    'Basic models only',
                    'Community support'
                ],
                limits: {
                    conversations_per_month: 90,
                    messages_per_conversation: 50,
                    models_access: ['gpt-4o-mini'],
                    storage_gb: 1
                }
            },
            {
                id: 'pro',
                name: 'Pro',
                description: 'Advanced features for power users',
                price_monthly: 8,
                price_yearly: 80,
                features: [
                    'Unlimited conversations',
                    'Access to all models',
                    'Priority support',
                    'Higher message limits',
                    '5GB storage'
                ],
                limits: {
                    conversations_per_month: 1000,
                    messages_per_conversation: 500,
                    models_access: ['gpt-4o', 'claude-3-5-sonnet', 'gemini-pro', 'gpt-4o-mini'],
                    storage_gb: 5
                }
            },
            {
                id: 'premium',
                name: 'Premium',
                description: 'Ultimate experience with all features',
                price_monthly: 15,
                price_yearly: 150,
                features: [
                    'Unlimited conversations',
                    'Access to all models',
                    'Priority support',
                    'Highest message limits',
                    '20GB storage',
                    'Early access to new features'
                ],
                limits: {
                    conversations_per_month: 10000,
                    messages_per_conversation: 2000,
                    models_access: ['gpt-4o', 'claude-3-5-sonnet', 'gemini-pro', 'gpt-4o-mini'],
                    storage_gb: 20
                }
            }
        ];
    }
    /**
     * Get all subscription plans
     */
    async getSubscriptionPlans() {
        return this.subscriptionPlans;
    }
    /**
     * Get subscription plan by ID
     */
    async getSubscriptionPlanById(id) {
        return this.subscriptionPlans.find(plan => plan.id === id);
    }
    /**
     * Track message usage for user
     */
    async trackMessageUsage(userId, modelId, tokensUsed) {
        const supabase = (0, db_1.getSupabase)();
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        // Create or update usage log entry
        const { error } = await supabase
            .from('usage_logs')
            .upsert({
            user_id: userId,
            model_id: modelId,
            tokens_used: tokensUsed,
            period: currentMonth,
            created_at: new Date().toISOString()
        }, {
            onConflict: 'user_id,model_id,period'
        });
        if (error) {
            console.error('Failed to track message usage:', error);
            throw error;
        }
    }
    /**
     * Get user's usage for current period
     */
    async getUserUsage(userId, period = new Date().toISOString().slice(0, 7)) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('usage_logs')
            .select('tokens_used')
            .eq('user_id', userId)
            .eq('period', period)
            .single();
        if (error) {
            return null;
        }
        return data;
    }
    /**
     * Check if user has exceeded usage limits
     */
    async checkUsageLimits(userId, period = new Date().toISOString().slice(0, 7)) {
        const userUsage = await this.getUserUsage(userId, period);
        const userSubscription = await this.getUserSubscription(userId);
        if (!userSubscription) {
            // No subscription, use free tier limits
            const freePlan = this.subscriptionPlans.find(p => p.id === 'free');
            if (!freePlan)
                return { exceeded: false };
            const limit = freePlan.limits.messages_per_conversation;
            const used = userUsage?.tokens_used || 0;
            return { exceeded: used >= limit, limit, used };
        }
        const plan = this.subscriptionPlans.find(p => p.id === userSubscription.plan);
        if (!plan)
            return { exceeded: false };
        const limit = plan.limits.messages_per_conversation;
        const used = userUsage?.tokens_used || 0;
        return { exceeded: used >= limit, limit, used };
    }
    /**
     * Get user subscription
     */
    async getUserSubscription(userId) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('user_id', userId)
            .single();
        if (error) {
            return null;
        }
        return data;
    }
    /**
     * Create or update user subscription
     */
    async upsertUserSubscription(userId, planId) {
        const supabase = (0, db_1.getSupabase)();
        const subscription = {
            user_id: userId,
            plan: planId,
            status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            created_at: new Date().toISOString()
        };
        const { data, error } = await supabase
            .from('subscriptions')
            .upsert(subscription, { onConflict: 'user_id' })
            .select()
            .single();
        if (error) {
            console.error('Failed to upsert subscription:', error);
            throw error;
        }
        return data;
    }
}
exports.SubscriptionService = SubscriptionService;
// Export singleton instance
exports.subscriptionService = new SubscriptionService();
//# sourceMappingURL=subscriptionService.js.map