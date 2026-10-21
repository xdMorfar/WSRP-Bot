import { Schema, model, models } from 'mongoose';

const SessionSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: false },
    hostId: String,
    startedAt: Date,
    endedAt: Date,
    messageId: String,
    channelId: String,
    voters: { type: [String], default: [] },
    lastVoteOpenedAt: Date,
    voteThresholdNotified: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const SessionModel = models.Session || model('Session', SessionSchema);
