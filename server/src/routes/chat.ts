import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AIService } from '../services/AIService';
import { Chat } from '../models/Chat';
import mongoose from 'mongoose';

const router = Router();
const isDBConnected = () => mongoose.connection.readyState === 1;

const chatMessageSchema = z.object({
  rumorId: z.string().optional(),
  chatId: z.string().optional(),
  message: z.string().min(1).max(2000),
  // Pass verdict context directly if DB is unavailable
  verdictContext: z.object({
    query: z.string().optional(),
    verdict: z.string().optional(),
    confidence: z.number().optional(),
    reasoning: z.string().optional(),
  }).optional(),
});

router.post('/stream', async (req: Request, res: Response) => {
  console.log('[Chat] 📥 Request body:', JSON.stringify(req.body).slice(0, 300));

  try {
    const parsed = chatMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
      return;
    }

    const { rumorId, chatId, message, verdictContext } = parsed.data;

    // DB-less mode: stream directly with context from the request
    if (!isDBConnected()) {
      console.warn('[Chat] ⚠️  DB not connected — streaming without persisting conversation.');
      res.setHeader('X-Chat-ID', 'no-db');
      await AIService.streamChatResponseNoDB(res, message, verdictContext);
      return;
    }

    let activeChatId = chatId;

    if (!activeChatId) {
      if (!rumorId) {
        res.status(400).json({ error: 'Either rumorId or chatId must be provided.' });
        return;
      }
      const newChat = new Chat({ rumorId, messages: [] });
      await newChat.save();
      activeChatId = newChat._id.toString();
      console.log(`[Chat] ✅ New chat created: ${activeChatId}`);
    } else {
      console.log(`[Chat] 🔄 Continuing chat: ${activeChatId}`);
    }

    res.setHeader('X-Chat-ID', activeChatId);
    await AIService.streamChatResponse(res, activeChatId, message);
  } catch (error: any) {
    console.error('[Chat] ❌ Route error:', error?.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
