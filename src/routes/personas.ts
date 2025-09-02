import { Router, Request, Response } from 'express';
import { personaService } from '../services/personaService';
import { PersonasResponse, ErrorResponse } from '../types';

const router = Router();

/**
 * GET /api/personas
 * Returns the list of available personas for the client
 */
router.get('/', (req: Request, res: Response<PersonasResponse | ErrorResponse>) => {
  try {
    const personas = personaService.getAllPersonas();

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
 * GET /api/personas/:id
 * Returns a specific persona by ID
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const persona = personaService.getPersona(id);

    if (!persona) {
      return res.status(404).json({
        error: 'Persona not found',
        code: 'PERSONA_NOT_FOUND'
      });
    }

    res.json({ persona });
  } catch (error) {
    console.error('Error fetching persona:', error);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

export default router;