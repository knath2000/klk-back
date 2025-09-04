import { Router, Request, Response } from 'express';
import { personaService } from '../services/personaService';
import { feedbackService } from '../services/feedbackService';
import { ChatService } from '../services/chatService';
import { PersonasResponse, ErrorResponse, FeedbackData, FeedbackResponse, DebugTestRequest, DebugTestResponse, FeedbackStats } from '../types';
import fs from 'fs';
import path from 'path';

const router = Router();

/**
 * GET /api/personas
 * Returns the list of available personas for the client
 */
router.get('/', (req: Request, res: Response) => {
  try {
    console.log('=== PERSONAS API REQUEST ===');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   Request Origin:', req.headers.origin);
    console.log('   User Agent:', req.headers['user-agent']);
    console.log('   Process CWD:', process.cwd());
    
    // Debug file system structure
    try {
      console.log('📂 Current directory:', process.cwd());
      console.log('📂 Directory contents:', fs.readdirSync(process.cwd()));
      
      if (fs.existsSync(path.join(process.cwd(), 'personas'))) {
        console.log('📂 Personas directory contents:', fs.readdirSync(path.join(process.cwd(), 'personas')));
      } else {
        console.log('❌ Personas directory not found in current path');
        
        // Try to find personas directory
        const searchPaths = [
          path.join(process.cwd(), 'personas'),
          path.join(process.cwd(), 'server', 'personas'),
          '/app/personas',
          path.join(__dirname, '../../personas')
        ];
        
        for (const searchPath of searchPaths) {
          if (fs.existsSync(searchPath)) {
            console.log('✅ Found personas at:', searchPath);
            console.log('📂 Personas contents:', fs.readdirSync(searchPath));
            break;
          }
        }
      }
    } catch (fsError) {
      console.error('❌ File system error:', fsError);
    }
    
    // Get personas from service
    const personas = personaService.getAllPersonas();
    console.log('📊 Personas from service:', personas.length);
    
    if (personas.length === 0) {
      console.log('⚠️  No personas found - checking service internals');
      // Try to reload personas
      console.log('🔄 Attempting to reload personas...');
      personaService.reloadPersonas();
      const reloadedPersonas = personaService.getAllPersonas();
      console.log('📊 Personas after reload:', reloadedPersonas.length);
    }
    
    // Add CORS headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    res.json({
      personas: personaService.getAllPersonas()
    });
    
    console.log('✅ Personas API response sent successfully with', personaService.getAllPersonas().length, 'personas');
  } catch (error) {
    console.error('💥 Error in personas API:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/personas/feedback
 * Collect user feedback on assistant responses
 */
router.post('/feedback', (req: Request, res: Response<FeedbackResponse | ErrorResponse>) => {
  try {
    const feedback: FeedbackData = req.body;

    // Validate required fields
    if (!feedback.messageId || !feedback.userMessage || !feedback.assistantResponse) {
      return res.status(400).json({
        error: 'Missing required fields: messageId, userMessage, assistantResponse',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate rating (1-5)
    if (!feedback.rating || feedback.rating < 1 || feedback.rating > 5) {
      return res.status(400).json({
        error: 'Rating must be between 1 and 5',
        code: 'INVALID_RATING'
      });
    }

    // Validate category
    const validCategories = ['quality', 'accuracy', 'engagement', 'language', 'other'];
    if (!feedback.category || !validCategories.includes(feedback.category)) {
      return res.status(400).json({
        error: 'Invalid category. Must be one of: ' + validCategories.join(', '),
        code: 'INVALID_CATEGORY'
      });
    }

    // Add metadata
    const enrichedFeedback: FeedbackData = {
      ...feedback,
      userAgent: req.headers['user-agent'],
      sessionId: req.headers['x-session-id'] as string || 'unknown',
      timestamp: Date.now()
    };

    // Store feedback
    const feedbackId = feedbackService.storeFeedback(enrichedFeedback);

    res.setHeader('Content-Type', 'application/json');
    res.json({
      success: true,
      feedbackId,
      message: 'Feedback received successfully'
    });
  } catch (error) {
    console.error('Error processing feedback:', error);
    res.status(500).json({
      error: 'Failed to process feedback',
      code: 'FEEDBACK_ERROR'
    });
  }
});

/**
 * POST /api/personas/debug/test
 * Test assistant response with specific message and persona
 */
router.post('/debug/test', async (req: Request, res: Response<DebugTestResponse | ErrorResponse>) => {
  try {
    const testRequest: DebugTestRequest = req.body;

    if (!testRequest.message || !testRequest.persona) {
      return res.status(400).json({
        error: 'Missing required fields: message, persona',
        code: 'MISSING_TEST_FIELDS'
      });
    }

    // Validate persona exists
    if (!personaService.isValidCountryKey(testRequest.persona)) {
      return res.status(400).json({
        error: 'Invalid persona key',
        code: 'INVALID_PERSONA'
      });
    }

    // For now, return a mock response (in production, this would test the actual chat service)
    const mockResponse = {
      success: true,
      data: {
        messageId: `test_${Date.now()}`,
        userMessage: testRequest.message,
        assistantResponse: `¡Hola! Soy el asistente para ${testRequest.persona.toUpperCase()}. Tu mensaje fue: "${testRequest.message}". Esta es una respuesta de prueba.`,
        persona: testRequest.persona,
        qualityScore: 4.5,
        validationIssues: [],
        retriesUsed: 0,
        processingTime: 150,
        timestamp: Date.now()
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.json(mockResponse);
  } catch (error) {
    console.error('Error in debug test:', error);
    res.status(500).json({
      error: 'Debug test failed',
      code: 'DEBUG_TEST_ERROR'
    });
  }
});

/**
 * GET /api/personas/feedback/stats
 * Get feedback statistics and metrics
 */
router.get('/feedback/stats', (req: Request, res: Response<FeedbackStats | ErrorResponse>) => {
  try {
    const stats = feedbackService.getFeedbackStats();
    
    res.setHeader('Content-Type', 'application/json');
    res.json(stats);
  } catch (error) {
    console.error('Error fetching feedback stats:', error);
    res.status(500).json({
      error: 'Failed to fetch feedback statistics',
      code: 'STATS_ERROR'
    });
  }
});

/**
 * GET /api/personas/debug
 * Returns debug information about the server and personas
 */
router.get('/debug', (req: Request, res: Response) => {
  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      server: {
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
        platform: process.platform,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      },
      request: {
        origin: req.headers.origin,
        userAgent: req.headers['user-agent'],
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip
      },
      cors: {
        allowedOrigins: process.env.FRONTEND_URL ? 
          process.env.FRONTEND_URL.split(',').map(url => url.trim()) : 
          ["http://localhost:3000", "https://klk-front.vercel.app"],
        requestOrigin: req.headers.origin
      },
      personas: {
        count: personaService.getAllPersonas().length,
        data: personaService.getAllPersonas().map(p => ({
          id: p.id,
          country_key: p.country_key,
          displayName: p.displayName,
          safe_reviewed: p.safe_reviewed
        }))
      },
      feedback: {
        totalFeedback: feedbackService.getFeedbackStats().totalFeedback,
        averageRating: feedbackService.getFeedbackStats().averageRating
      }
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.json(debugInfo);
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({
      error: 'Debug endpoint error',
      code: 'DEBUG_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/personas/ping
 * Simple connectivity test endpoint
 */
router.get('/ping', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    status: 'pong',
    timestamp: new Date().toISOString(),
    server: 'personas-api',
    version: '1.0.0'
  });
});

export default router;
