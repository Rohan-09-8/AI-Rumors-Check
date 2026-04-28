import { Router } from 'express';
import { z } from 'zod';
import { FactCheckService } from '../services/FactCheckService';

const router = Router();

const verifySchema = z.object({
  query: z.string().min(3, 'Query must be at least 3 characters').max(500),
});

router.post('/', async (req, res) => {
  console.log('[Verify] 📥 Body:', JSON.stringify(req.body).slice(0, 200));

  // Guard: ensure JSON was parsed (body should be an object)
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({ error: 'Request body is missing or not JSON. Ensure Content-Type: application/json.' });
    return;
  }

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    return;
  }

  try {
    const result = await FactCheckService.verifyRumor(parsed.data.query);
    res.json(result);
  } catch (err: any) {
    console.error('[Verify] ❌ Error:', err?.message);
    res.status(500).json({
      error: err?.message?.includes('GEMINI_API_KEY')
        ? 'GEMINI_API_KEY is undefined in .env — AI cannot process requests.'
        : 'Internal server error',
    });
  }
});

export default router;
