import { Schema, model, models } from 'mongoose';
const ShiftSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    clockInAt: { type: Date, required: true },
    clockOutAt: Date,
    durationSeconds: Number,
  },
  { timestamps: true },
);
ShiftSchema.index({ guildId: 1, userId: 1, clockOutAt: 1 });
export const ShiftModel = models.Shift || model('Shift', ShiftSchema);
