// AIService.ts — streaming chat with immediate key failover
import { Response } from 'express';
import { Chat } from '../models/Chat';
import mongoose from 'mongoose';
import { streamWithRotation } from './geminiPool';

const isDBConnected = () => mongoose.connection.readyState === 1;

function startSSE(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

const sendToken  = (res: Response, token: string) => res.write(`data: ${JSON.stringify({ token })}\n\n`);
const sendDone   = (res: Response) => { res.write('data: [DONE]\n\n'); res.end(); };
const sendError  = (res: Response, msg: string) => {
  res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};

// ── With DB ──────────────────────────────────────────────────
export class AIService {

  static async streamChatResponse(res: Response, chatId: string, newMessage: string) {
    startSSE(res);
    console.log('[AIService] 🟢 SSE chat:', chatId);

    try {
      const chat = isDBConnected() ? await Chat.findById(chatId).populate('rumorId') : null;
      if (!chat && isDBConnected()) return sendError(res, 'Chat session not found.');

      const sanitized = newMessage.replace(/[\u0000-\u001F\u007F]/g, '').trim();

      if (chat) {
        chat.messages.push({ role: 'user', content: sanitized, timestamp: new Date() });
        await chat.save();
      }

      const rumor = chat?.rumorId as any;
      const systemInstruction = rumor
        ? `You are the Truth Engine AI.\nRumor: "${rumor.query}"\nVerdict: ${rumor.verdict} (confidence ${Math.round((rumor.confidence || 0) * 100)}%)\nReasoning: ${rumor.reasoning}\nAnswer the user's question concisely and accurately.`
        : 'You are the Truth Engine AI. Help users understand and verify claims.';

      const history = (chat?.messages ?? []).slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

      let full = '';
      await streamWithRotation(systemInstruction, history, sanitized, token => {
        full += token;
        sendToken(res, token);
      });

      if (chat) {
        chat.messages.push({ role: 'assistant', content: full.trim(), timestamp: new Date() });
        await chat.save();
      }

      sendDone(res);

    } catch (err: any) {
      console.error('[AIService] ❌', err?.message);
      if (err?.isRateLimit) {
        sendError(res, `🟠 All keys cooling down — retry in ${err.retryAfter}s.`);
      } else {
        sendError(res, 'Truth Engine encountered an error. Please try again.');
      }
    }
  }

  // ── No-DB fallback (used when MongoDB is offline) ────────────
  static async streamChatResponseNoDB(
    res: Response,
    userMessage: string,
    context?: { query?: string; verdict?: string; confidence?: number; reasoning?: string }
  ) {
    startSSE(res);
    console.log('[AIService/NoDB] 🟢 SSE');

    try {
      const sanitized = userMessage.replace(/[\u0000-\u001F\u007F]/g, '').trim();
      const systemInstruction = context?.query
        ? `You are the Truth Engine AI.\nRumor: "${context.query}"\nVerdict: ${context.verdict} (confidence ${Math.round((context.confidence || 0) * 100)}%)\nReasoning: ${context.reasoning}\nAnswer the user's question concisely.`
        : 'You are the Truth Engine AI. Help users understand and verify claims.';

      await streamWithRotation(systemInstruction, [], sanitized, token => sendToken(res, token));
      sendDone(res);

    } catch (err: any) {
      console.error('[AIService/NoDB] ❌', err?.message);
      if (err?.isRateLimit) {
        sendError(res, `🟠 All keys cooling down — retry in ${err.retryAfter}s.`);
      } else {
        sendError(res, 'Truth Engine encountered an error. Please try again.');
      }
    }
  }
}
