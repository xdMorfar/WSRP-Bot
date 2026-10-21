import { Schema, model, models } from 'mongoose';
const LeaveRequestSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    requestId: { type: Number, required: true },
    userId: { type: String, required: true, index: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'denied', 'expired'], default: 'pending' },
    handledBy: String,
    handledAt: Date,
    messageId: String,
    channelId: String,
  },
  { timestamps: true },
);
LeaveRequestSchema.index({ guildId: 1, requestId: 1 }, { unique: true });
export const LeaveRequestModel = models.LeaveRequest || model('LeaveRequest', LeaveRequestSchema);
