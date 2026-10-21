import { Schema, model, models } from 'mongoose';
const LockdownStateSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: false },
    startedBy: String,
    startedAt: Date,
    channels: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);
export const LockdownStateModel = models.LockdownState || model('LockdownState', LockdownStateSchema);
