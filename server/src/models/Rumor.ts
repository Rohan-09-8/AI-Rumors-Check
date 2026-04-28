import mongoose, { Schema, Document } from 'mongoose';

export interface IRumor extends Document {
  query: string;
  verdict: 'True' | 'False' | 'Unverified' | 'Mixed';
  confidence: number;
  debunk_sources: string[];
  reasoning: string;
  createdAt: Date;
}

const RumorSchema: Schema = new Schema({
  query: { type: String, required: true },
  verdict: { type: String, enum: ['True', 'False', 'Unverified', 'Mixed'], default: 'Unverified' },
  confidence: { type: Number, default: 0 },
  debunk_sources: [{ type: String }],
  reasoning: { type: String, default: '' },
}, {
  timestamps: true,
});

// Text index for fuzzy searching on the query
RumorSchema.index({ query: 'text' });

// TTL index: Expires documents after 24 hours (86400 seconds) if they are unverified
RumorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400, partialFilterExpression: { verdict: 'Unverified' } });

export const Rumor = mongoose.model<IRumor>('Rumor', RumorSchema);
