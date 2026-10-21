import { Schema, model, models } from 'mongoose';

const TicketSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    ticketId: { type: Number, required: true },
    creatorId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    categoryKey: { type: String, required: true },
    answers: { type: [String], default: [] },
    claimedBy: String,
    participants: { type: [String], default: [] },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,
    closedBy: String,
    closeReason: String,
    transcriptMessageId: String,
    lastActivityAt: { type: Date, default: Date.now },
    inactivityRemindedAt: Date,
  },
  { timestamps: true },
);
TicketSchema.index({ guildId: 1, ticketId: 1 }, { unique: true });
export const TicketModel = models.Ticket || model('Ticket', TicketSchema);
