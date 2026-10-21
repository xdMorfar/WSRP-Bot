import { Schema, model, models } from 'mongoose';
const EconomySchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    balance: { type: Number, default: 0, min: 0 },
    lastDailyAt: Date,
    lastWorkAt: Date,
  },
  { timestamps: true },
);
EconomySchema.index({ guildId: 1, userId: 1 }, { unique: true });
export const EconomyModel = models.Economy || model('Economy', EconomySchema);
