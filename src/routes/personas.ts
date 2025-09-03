import { Router, Request, Response } from 'express';
import { personaService } from '../services/personaService';
import { PersonasResponse, ErrorResponse } from '../types';

const router = Router();

// Add CORS headerss to all persona routes
router.use((req, res, next) => {
  const allowedOrigins = process.env.FRONTEND_URL ? 
    process.env.FRONTEND_URL.split(',').map(url => url.trim()) : 
    ["http://localhost:3000", "https://klk-front.vercel.app"];
  
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  next();
});

/**
 * GET /api/personas
 * Returns the list of available personas for the client
 */
router.get('/', (req: Request, res: Response<PersonasResponse | ErrorResponse>) => {
  try {
    const personas = personaService.getAllPersonas();
    
    // Add CORS headers to response
    res.setHeader('Content-Type', 'application/json');
    
    res.json({
      personas
    });
  } catch (error) {
    console.error('Error fetching personas:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
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