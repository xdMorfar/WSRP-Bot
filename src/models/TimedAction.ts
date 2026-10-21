import { Schema, model, models } from 'mongoose';

const TimedActionSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ['suspension', 'reminder', 'loa'], required: true },
    executeAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending', index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
export const TimedActionModel = models.TimedAction || model('TimedAction', TimedActionSchema);
