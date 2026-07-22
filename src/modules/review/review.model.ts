import mongoose, { Schema, Document } from 'mongoose';
import { CodeReviewResult } from './review.schema';

export interface IReview extends Document {
  userId?: string;
  language: string;
  codeSnippet: string;
  review: CodeReviewResult;
  createdAt: Date;
}

const ReviewSchema: Schema = new Schema({
  userId: { type: String, default: 'anonymous' },
  language: { type: String, required: true },
  codeSnippet: { type: String, required: true },
  review: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const ReviewModel = mongoose.model<IReview>('Review', ReviewSchema);