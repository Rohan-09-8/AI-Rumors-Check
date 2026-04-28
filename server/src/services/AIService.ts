// AIService.ts — streaming chat with key rotation
import { Response } from 'express';
import { Chat } from '../models/Chat';
import mongoose from 'mongoose';
import { getAvailableClient, markRateLimited, allRateLimited, cooldownRemaining, getPool } from './geminiPool';

const isDBConnected = () => mongoose.connection.readyState === 1;
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

// ── SSE helpers ──────────────────────────────────────────────
function startSSE(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

const sendToken = (res: Response, token: string) =>
  res.write(`data: ${JSON.stringify({ token })}\n\n`);

const sendError = (res: Response, msg: string) => {
  res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};

// ── Core streaming with key + model cascade ──────────────────
async function streamWithKeyRotation(
  systemInstruction: string,
  history: { role: string; parts: { text: string }[] }[],
  userMessage: string,
  onToken: (t: string) => void
): Promise<void> {
  const pool = getPool();

  for (const entry of pool) {
    if (entry.cooldownUntil > Date.now()) {
      console.log(`[AIService] ⏩ Skipping ${entry.key} (cooldown)`);
      continue;
    }

    for (const modelName of MODELS) {
      try {
        console.log(`[AIService] 🧠 ${entry.key} × ${modelName}`);
        const model = entry.client.getGenerativeModel(
          { model: modelName, systemInstruction },
          { apiVersion: 'v1beta' }
        );
        const session = model.startChat({ history });
        const result  = await session.sendMessageStream(userMessage);

        for await (const chunk of result.stream) {
          const token = chunk.text();
          if (token) onToken(token);
        }
        console.log(`[AIService] ✅ ${entry.key} × ${modelName} stream done`);
        return; // success

      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        const is429 = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate');
        const is404 = msg.includes('404') || msg.toLowerCase().includes('not found');

        if (is429) {
          markRateLimited(entry.key, 60);
          break; // try next key
        } else if (is404) {
          console.warn(`[AIService] 404 on ${modelName} — trying next model`);
          continue;
        } else {
          console.error(`[AIService] ❌ ${entry.key} × ${modelName}: ${msg.slice(0, 120)}`);
          break;
        }
      }
    }
  }

  // All keys tried
  if (allRateLimited()) {
    const wait = cooldownRemaining();
    throw Object.assign(new Error(`All keys rate-limited. Retry in ${wait}s`), { isRateLimit: true, retryAfter: wait });
  }
  throw new Error('All Gemini models failed to respond.');
}

// ── Exported service ─────────────────────────────────────────
export class AIService {

  static async streamChatResponse(res: Response, chatId: string, newMessage: string) {
    startSSE(res);
    console.log('[AIService] 🟢 SSE chat:', chatId);

    try {
      const chat = await Chat.findById(chatId).populate('rumorId');
      if (!chat) return sendError(res, 'Chat session not found.');

      const sanitized = newMessage.replace(/[\u0000-\u001F\u007F]/g, '').trim();
      chat.messages.push({ role: 'user', content: sanitized, timestamp: new Date() });
      await chat.save();

      const rumor = chat.rumorId as any;
      const systemInstruction = rumor
        ? `You are the Truth Engine AI. Rumor: "${rumor.query}". Verdict: ${rumor.verdict}. Confidence: ${Math.round((rumor.confidence || 0) * 100)}%. Reasoning: ${rumor.reasoning}. Answer concisely.`
        : 'You are the Truth Engine AI. Help users understand and verify claims.';

      const history = chat.messages.slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

      let full = '';
      await streamWithKeyRotation(systemInstruction, history, sanitized, token => {
        full += token;
        sendToken(res, token);
      });

      chat.messages.push({ role: 'assistant', content: full.trim(), timestamp: new Date() });
      await chat.save();
      res.write('data: [DONE]\n\n');
      res.end();

    } catch (err: any) {
      console.error('[AIService] ❌', err?.message);
      if (err?.isRateLimit) {
        sendError(res, `🟠 All keys cooling down. Retry in ${err.retryAfter}s.`);
      } else {
        sendError(res, 'Truth Engine error. Please try again.');
      }
    }
  }

  static async streamChatResponseNoDB(
    res: Response,
    userMessage: string,
    context?: { query?: string; verdict?: string; confidence?: number; reasoning?: string }
  ) {
    startSSE(res);
    console.log('[AIService/NoDB] 🟢 SSE (no DB)');

    try {
      const sanitized = userMessage.replace(/[\u0000-\u001F\u007F]/g, '').trim();
      const systemInstruction = context?.query
        ? `You are the Truth Engine AI. Rumor: "${context.query}". Verdict: ${context.verdict}. Confidence: ${Math.round((context.confidence || 0) * 100)}%. Reasoning: ${context.reasoning}. Answer concisely.`
        : 'You are the Truth Engine AI. Help users verify claims.';

      await streamWithKeyRotation(systemInstruction, [], sanitized, token => sendToken(res, token));
      res.write('data: [DONE]\n\n');
      res.end();

    } catch (err: any) {
      console.error('[AIService/NoDB] ❌', err?.message);
      if (err?.isRateLimit) {
        sendError(res, `🟠 All keys cooling down. Retry in ${err.retryAfter}s.`);
      } else {
        sendError(res, 'Truth Engine error. Please try again.');
      }
    }
  }
}
