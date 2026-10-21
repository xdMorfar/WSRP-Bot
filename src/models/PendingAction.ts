import { Schema, model, models } from 'mongoose';
const PendingActionSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true },
    actorId: { type: String, required: true },
    kind: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    consumedAt: Date,
  },
  { timestamps: true },
);
export const PendingActionModel = models.PendingAction || model('PendingAction', PendingActionSchema);
