"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionService = exports.SubscriptionService = void 0;
const client_1 = require("@prisma/client");
class SubscriptionService {
    constructor() {
        this.prisma = new client_1.PrismaClient();
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
        const period = new Date().toISOString().slice(0, 7); // YYYY-MM
        // Upsert on unique (user_id, model_id, period)
        await this.prisma.usageLog.upsert({
            where: {
                user_id_model_id_period: {
                    user_id: userId,
                    model_id: modelId,
                    period
                }
            },
            update: {
                tokens_used: tokensUsed,
                created_at: new Date()
            },
            create: {
                user_id: userId,
                model_id: modelId,
                tokens_used: tokensUsed,
                period,
                created_at: new Date()
            }
        });
    }
    /**
     * Get user's usage for current period
     */
    async getUserUsage(userId, period = new Date().toISOString().slice(0, 7)) {
        // Sum tokens across all models for the given user and period
        const logs = await this.prisma.usageLog.findMany({
            where: { user_id: userId, period },
            select: { tokens_used: true }
        });
        if (!logs || logs.length === 0)
            return { tokens_used: 0 };
        const total = logs.reduce((sum, row) => sum + (row.tokens_used || 0), 0);
        return { tokens_used: total };
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
        const sub = await this.prisma.subscription.findUnique({
            where: { user_id: userId }
        });
        return sub ?? null;
    }
    /**
     * Create or update user subscription
     */
    async upsertUserSubscription(userId, planId) {
        const now = new Date();
        const sub = await this.prisma.subscription.upsert({
            where: { user_id: userId },
            update: {
                plan: planId,
                status: 'active',
                current_period_start: now,
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            },
            create: {
                user_id: userId,
                plan: planId,
                status: 'active',
                current_period_start: now,
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                created_at: now
            }
        });
        return sub;
    }
}
exports.SubscriptionService = SubscriptionService;
// Export singleton instance
exports.subscriptionService = new SubscriptionService();
//# sourceMappingURL=subscriptionService.js.map