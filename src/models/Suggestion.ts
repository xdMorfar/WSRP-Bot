import { Schema, model, models } from 'mongoose';
const SuggestionSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    suggestionId: { type: Number, required: true },
    authorId: { type: String, required: true },
    content: { type: String, required: true },
    status: { type: String, enum: ['pending', 'planned', 'accepted', 'declined', 'implemented'], default: 'pending' },
    upvotes: { type: [String], default: [] },
    downvotes: { type: [String], default: [] },
    channelId: String,
    messageId: String,
  },
  { timestamps: true },
);
SuggestionSchema.index({ guildId: 1, suggestionId: 1 }, { unique: true });
export const SuggestionModel = models.Suggestion || model('Suggestion', SuggestionSchema);
