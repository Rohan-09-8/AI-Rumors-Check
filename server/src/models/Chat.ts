import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface IChat extends Document {
  rumorId: mongoose.Types.ObjectId;
  messages: IChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const ChatMessageSchema: Schema = new Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const ChatSchema: Schema = new Schema({
  rumorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rumor', required: true },
  messages: [ChatMessageSchema]
}, {
  timestamps: true
});

export const Chat = mongoose.model<IChat>('Chat', ChatSchema);
