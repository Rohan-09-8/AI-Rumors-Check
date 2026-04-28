import { Router } from 'express';
import { z } from 'zod';
import { FactCheckService } from '../services/FactCheckService';

const router = Router();

const verifySchema = z.object({
  query: z.string().min(3, 'Query must be at least 3 characters').max(500),
});

router.post('/', async (req, res) => {
  console.log('[Verify] 📥 Body:', JSON.stringify(req.body).slice(0, 200));

  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({ error: 'Request body missing or not JSON.' });
    return;
  }

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    return;
  }

  try {
    const result = await FactCheckService.verifyRumor(parsed.data.query);

    // Surface 429 to the client so the UI can show the cooldown message
    if (result.rateLimited) {
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Truth Engine is cooling down... wait 30 seconds.',
        retryAfter: 30,
      });
      return;
    }

    res.json(result);
  } catch (err: any) {
    console.error('[Verify] ❌ Error:', err?.message);
    res.status(500).json({
      error: err?.message?.includes('GEMINI_API_KEY')
        ? 'GEMINI_API_KEY is undefined in .env'
        : 'Internal server error',
    });
  }
});

export default router;
