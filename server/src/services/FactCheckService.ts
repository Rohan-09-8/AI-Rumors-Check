// FactCheckService.ts
// 1. Checks 24h MongoDB cache first
// 2. Calls Gemini via round-robin pool (immediate failover on 429)
// 3. Saves result to DB and returns
import { Rumor } from '../models/Rumor';
import mongoose from 'mongoose';
import { generateWithRotation } from './geminiPool';

const isDBConnected = () => mongoose.connection.readyState === 1;

type Verdict = 'True' | 'False' | 'Unverified' | 'Mixed';

export interface VerifyResult {
  _id: string | null;
  query: string;
  verdict: Verdict;
  confidence: number;
  debunk_sources: string[];
  reasoning: string;
  fromCache?: boolean;
  rateLimited?: boolean;
  retryAfter?: number;
}

// Normalise query for cache lookup (lower-case, collapse spaces, strip punctuation)
function normalise(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
}

export class FactCheckService {

  static async verifyRumor(query: string): Promise<VerifyResult> {
    const queryNorm = normalise(query);
    console.log(`[FactCheck] 🔍 "${query.slice(0, 80)}" (norm: "${queryNorm.slice(0, 50)}")`);

    // ── 1. 24h cache check ───────────────────────────────────
    if (isDBConnected()) {
      try {
        const cached = await Rumor.findOne({ queryNorm });
        if (cached && cached.verdict !== 'Unverified') {
          const ageMin = Math.round((Date.now() - cached.createdAt.getTime()) / 60000);
          console.log(`[FactCheck] ✅ Cache hit (${ageMin}m old) → ${cached.verdict}`);
          return {
            _id: cached._id?.toString() ?? null,
            query: cached.query,
            verdict: cached.verdict as Verdict,
            confidence: cached.confidence,
            debunk_sources: cached.debunk_sources ?? [],
            reasoning: cached.reasoning,
            fromCache: true,
          };
        }
      } catch (e: any) {
        console.warn('[FactCheck] Cache read error:', e.message);
      }
    }

    // ── 2. Call Gemini via pool ──────────────────────────────
    let geminiResult: VerifyResult;
    try {
      geminiResult = await this.callGemini(query, queryNorm);
    } catch (err: any) {
      if (err?.isRateLimit) {
        return {
          _id: null, query,
          verdict: 'Unverified', confidence: 0, debunk_sources: [],
          reasoning: err.message,
          rateLimited: true,
          retryAfter: err.retryAfter ?? 60,
        };
      }
      throw err;
    }

    // ── 3. Persist to DB ─────────────────────────────────────
    if (isDBConnected() && geminiResult.verdict !== 'Unverified') {
      try {
        // upsert by normalised query so we don't get duplicate-key errors
        const doc = await Rumor.findOneAndUpdate(
          { queryNorm },
          {
            query,
            queryNorm,
            verdict: geminiResult.verdict,
            confidence: geminiResult.confidence,
            debunk_sources: geminiResult.debunk_sources,
            reasoning: geminiResult.reasoning,
            createdAt: new Date(), // reset TTL clock on update
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        geminiResult._id = doc?._id?.toString() ?? null;
        console.log('[FactCheck] 💾 Saved to DB');
      } catch (e: any) {
        // Duplicate key from race condition is fine — just ignore
        if (!e.message?.includes('E11000')) {
          console.warn('[FactCheck] DB save error:', e.message);
        }
      }
    }

    return geminiResult;
  }

  // ── Gemini call ──────────────────────────────────────────────
  private static async callGemini(query: string, queryNorm: string): Promise<VerifyResult> {
    const prompt = [
      'You are the Truth Engine, a professional fact-checking AI with access to current web search.',
      'Carefully analyse the claim below and respond with ONLY valid JSON — absolutely no markdown, no explanation outside JSON.',
      '',
      `Claim: "${query}"`,
      '',
      'Required response format (one JSON object, nothing else):',
      '{',
      '  "verdict": "True" | "False" | "Mixed" | "Unverified",',
      '  "confidence": <number 0.0 to 1.0>,',
      '  "debunk_source": ["<url1>", "<url2>"],',
      '  "reasoning": "<one clear paragraph explaining the verdict>"',
      '}',
    ].join('\n');

    const { text, usedKey, usedModel } = await generateWithRotation(prompt);
    console.log(`[FactCheck] 📩 Response from ${usedKey} × ${usedModel}: ${text.slice(0, 150)}`);

    // Strip accidental markdown fences
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      // Model returned non-JSON — treat as unverified
      console.warn('[FactCheck] ⚠️ JSON parse failed, raw:', text.slice(0, 200));
      return {
        _id: null, query,
        verdict: 'Unverified', confidence: 0, debunk_sources: [],
        reasoning: 'Truth Engine returned an unparseable response. Please try again.',
      };
    }

    const verdict: Verdict = ['True', 'False', 'Mixed', 'Unverified'].includes(parsed.verdict)
      ? parsed.verdict : 'Unverified';

    return {
      _id: null,
      query,
      verdict,
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0,
      debunk_sources: Array.isArray(parsed.debunk_source) ? parsed.debunk_source : [],
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided.',
    };
  }
}
