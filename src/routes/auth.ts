import express, { Request, Response, Router } from 'express';
import { getSupabase } from '../services/db'; // Potentially needed for session invalidation, but focusing on cookies first.
import { neonAuthMiddleware } from '../middleware/auth';

const router: Router = express.Router();

// Helper to clear a cookie via response header
const clearCookie = (res: Response, name: string) => {
  res.clearCookie(name, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // Match client-side assumption
    path: '/'
  });
};

// GET /api/auth/user
// Returns the authenticated user's profile. Protected by neonAuthMiddleware.
router.get('/user', neonAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // Return minimal, non-sensitive profile for frontend
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email || null,
        name: user.name || null
      }
    });
  } catch (error) {
    console.error('[Auth /user] Error returning user profile:', error);
    return res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// POST /api/logout
// Clears server-side session cookies to complete logout flow.
router.post('/logout', async (req: Request, res: Response) => {
  try {
    // 1. Clear cookies based on Stack Auth heuristics (token/session/stack related)
    const cookiesToClear = Object.keys(req.cookies || {}).filter(name => {
      const n = name.toLowerCase();
      return n.includes('stack') && (n.includes('token') || n.includes('session'));
    });

    cookiesToClear.forEach(name => {
      clearCookie(res, name);
    });

    // 2. If using server-side sessions (e.g., NextAuth session store), invalidate here.
    // Since we are using Stack Auth (likely JWT based), clearing cookies should suffice
    // if the middleware relies on them for session establishment.

    res.status(200).json({ message: 'Logout successful. Client cookies cleared.' });
  } catch (error) {
    console.error('Error during server logout:', error);
    res.status(500).json({ error: 'Failed to process logout on server side' });
  }
});

export default router;