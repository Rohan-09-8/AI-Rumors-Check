import mongoose, { Schema, Document } from 'mongoose';

export interface IRumor extends Document {
  query: string;
  queryNorm: string;         // lowercased + trimmed for cache lookup
  verdict: 'True' | 'False' | 'Unverified' | 'Mixed';
  confidence: number;
  debunk_sources: string[];
  reasoning: string;
  usedKey?: string;          // which Gemini key answered this
  usedModel?: string;        // which model answered this
  createdAt: Date;
  updatedAt: Date;
}

const RumorSchema: Schema = new Schema({
  query:        { type: String, required: true },
  queryNorm:    { type: String, required: true },  // normalised for lookup
  verdict:      { type: String, enum: ['True', 'False', 'Unverified', 'Mixed'], default: 'Unverified' },
  confidence:   { type: Number, default: 0 },
  debunk_sources: [{ type: String }],
  reasoning:    { type: String, default: '' },
  usedKey:      { type: String },
  usedModel:    { type: String },
}, { timestamps: true });

// ── Indexes ───────────────────────────────────────────────────
// Fast exact-match on normalised query (used for 24h cache)
RumorSchema.index({ queryNorm: 1 }, { unique: true, sparse: true });

// Full-text search on original query (used for suggestions)
RumorSchema.index({ query: 'text' });

// TTL: all documents expire after 24 hours (86400s)
// This keeps the cache fresh and avoids stale data
RumorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const Rumor = mongoose.model<IRumor>('Rumor', RumorSchema);
