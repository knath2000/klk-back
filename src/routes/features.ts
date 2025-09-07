import { Router } from 'express';

const router = Router();

// Get T3 Chat features information
router.get('/', (req, res) => {
  res.json({
    features: {
      instant_model_switching: {
        description: "Switch between AI models in real-time without losing context",
        endpoints: [
          "GET /api/models",
          "POST /api/models/:id/switch"
        ],
        benefits: [
          "Compare responses from different models",
          "Choose the best model for each conversation",
          "No context loss during switching"
        ]
      },
      conversation_search: {
        description: "Powerful search across conversations and messages",
        endpoints: [
          "GET /api/search/:query",
          "GET /api/search/messages/:query",
          "GET /api/search/recent"
        ],
        benefits: [
          "Find any conversation instantly",
          "Search through message content",
          "Get recent conversation suggestions"
        ]
      },
      local_first_architecture: {
        description: "Privacy-focused local storage with optional cloud sync",
        endpoints: [
          "GET /api/conversations",
          "POST /api/conversations",
          "PUT /api/conversations/:id"
        ],
        benefits: [
          "Conversations stay on your device",
          "Optional cloud backup",
          "Cross-device sync when needed"
        ]
      },
      multi_model_support: {
        description: "Access to multiple AI models from different providers",
        endpoints: [
          "GET /api/models",
          "GET /api/models/capability/:capability"
        ],
        benefits: [
          "OpenAI, Anthropic, Google models",
          "Model-specific capabilities",
          "Automatic fallback for unavailable models"
        ]
      },
      subscription_management: {
        description: "Flexible subscription plans with usage tracking",
        endpoints: [
          "GET /api/subscription/plans",
          "GET /api/subscription",
          "POST /api/subscription/subscribe"
        ],
        benefits: [
          "Free, Pro, and Premium tiers",
          "Usage-based pricing",
          "Flexible upgrade/downgrade"
        ]
      }
    },
    architecture: {
      frontend: [
        "Next.js 14 with App Router",
        "TypeScript for type safety",
        "Framer Motion for animations",
        "Tailwind CSS for styling"
      ],
      backend: [
        "Node.js with Express",
        "TypeScript",
        "Prisma ORM",
        "Socket.IO for real-time",
        "Supabase for database"
      ],
      deployment: [
        "Railway for backend",
        "Vercel for frontend",
        "Docker for containerization",
        "GitHub Actions for CI/CD"
      ]
    }
  });
});

export default router;