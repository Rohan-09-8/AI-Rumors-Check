// FactCheckService.ts — uses rotating Gemini key pool
import { Rumor } from '../models/Rumor';
import mongoose from 'mongoose';
import { getAvailableClient, markRateLimited, allRateLimited, cooldownRemaining, getPool } from './geminiPool';

const isDBConnected = () => mongoose.connection.readyState === 1;
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
type Verdict = 'True' | 'False' | 'Unverified' | 'Mixed';

export interface VerifyResult {
  _id: string | null;
  query: string;
  verdict: Verdict;
  confidence: number;
  debunk_sources: string[];
  reasoning: string;
  rateLimited?: boolean;
  retryAfter?: number;
}

export class FactCheckService {

  static async verifyRumor(query: string): Promise<VerifyResult> {
    console.log(`[FactCheck] 🔍 Verifying: "${query.slice(0, 100)}"`);

    // ── DB cache check ───────────────────────────────────────
    if (isDBConnected()) {
      try {
        const cached = await Rumor.findOne({ query });
        if (cached && cached.verdict !== 'Unverified') {
          console.log(`[FactCheck] ✅ Cache hit → ${cached.verdict}`);
          return {
            _id: cached._id?.toString() ?? null,
            query: cached.query,
            verdict: cached.verdict as Verdict,
            confidence: cached.confidence,
            debunk_sources: cached.debunk_sources ?? [],
            reasoning: cached.reasoning,
          };
        }
      } catch (e: any) {
        console.warn('[FactCheck] Cache error:', e.message);
      }
    }

    // ── Gemini call with key rotation ────────────────────────
    const result = await this.geminiSearch(query);

    if (result.rateLimited) return { _id: null, query, ...result, debunk_sources: [] };

    // ── Persist to DB ─────────────────────────────────────────
    if (isDBConnected()) {
      try {
        const doc = new Rumor({
          query,
          verdict: result.verdict,
          confidence: result.confidence,
          debunk_sources: result.debunk_source,
          reasoning: result.reasoning,
        });
        await doc.save();
        return {
          _id: doc._id?.toString() ?? null,
          query,
          verdict: result.verdict,
          confidence: result.confidence,
          debunk_sources: result.debunk_source,
          reasoning: result.reasoning,
        };
      } catch (e: any) {
        console.warn('[FactCheck] DB save failed:', e.message);
      }
    }

    return {
      _id: null, query,
      verdict: result.verdict,
      confidence: result.confidence,
      debunk_sources: result.debunk_source,
      reasoning: result.reasoning,
    };
  }

  // ── Try every key × every model ──────────────────────────
  private static async geminiSearch(query: string): Promise<{
    verdict: Verdict; confidence: number; debunk_source: string[]; reasoning: string;
    rateLimited?: boolean; retryAfter?: number;
  }> {
    const prompt = [
      'You are the Truth Engine, a professional fact-checking AI.',
      'Analyse the claim below and respond ONLY with valid JSON — no markdown, no extra text.',
      '',
      `Claim: "${query}"`,
      '',
      'JSON schema:',
      '{"verdict":"True"|"False"|"Mixed"|"Unverified","confidence":<0.0-1.0>,"debunk_source":["<url>"],"reasoning":"<paragraph>"}',
    ].join('\n');

    const pool = getPool();

    for (const entry of pool) {
      // Skip keys still on cooldown
      if (entry.cooldownUntil > Date.now()) {
        console.log(`[FactCheck] ⏩ Skipping ${entry.key} (cooldown)`);
        continue;
      }

      for (const modelName of MODELS) {
        try {
          console.log(`[FactCheck] 🧠 ${entry.key} × ${modelName}`);
          const model = entry.client.getGenerativeModel(
            { model: modelName, tools: [{ googleSearch: {} } as any] },
            { apiVersion: 'v1beta' }
          );

          const response = await model.generateContent(prompt);
          const raw = response.response.text().trim()
            .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

          const parsed = JSON.parse(raw);
          const verdict: Verdict = ['True', 'False', 'Mixed', 'Unverified'].includes(parsed.verdict)
            ? parsed.verdict : 'Unverified';

          console.log(`[FactCheck] ✅ ${entry.key} × ${modelName} → ${verdict}`);
          return {
            verdict,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
            debunk_source: Array.isArray(parsed.debunk_source) ? parsed.debunk_source : [],
            reasoning: parsed.reasoning || 'No reasoning provided.',
          };

        } catch (err: any) {
          const msg: string = err?.message ?? String(err);
          const is429 = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate');
          const is404 = msg.includes('404') || msg.toLowerCase().includes('not found');

          if (is429) {
            // Mark this key as rate-limited and try next key immediately
            markRateLimited(entry.key, 60);
            break; // break model loop → try next key
          } else if (is404) {
            console.warn(`[FactCheck] 404 on ${modelName} — trying next model`);
            continue; // try next model with same key
          } else {
            console.error(`[FactCheck] ❌ ${entry.key} × ${modelName}: ${msg.slice(0, 120)}`);
            break; // unexpected error — try next key
          }
        }
      }
    }

    // All keys exhausted / rate-limited
    if (allRateLimited()) {
      const wait = cooldownRemaining();
      console.error(`[FactCheck] 🚦 All ${pool.length} keys rate-limited. Retry in ${wait}s`);
      return {
        verdict: 'Unverified', confidence: 0, debunk_source: [],
        reasoning: `All API keys rate-limited. Retry in ${wait}s.`,
        rateLimited: true, retryAfter: wait,
      };
    }

    return {
      verdict: 'Unverified', confidence: 0, debunk_source: [],
      reasoning: 'All Gemini models failed to respond. Please try again.',
    };
  }
}
