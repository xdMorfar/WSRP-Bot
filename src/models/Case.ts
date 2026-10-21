import { Schema, model, models } from 'mongoose';

const AmendmentSchema = new Schema(
  {
    authorId: String,
    at: { type: Date, default: Date.now },
    note: String,
  },
  { _id: false },
);

const CaseSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    caseId: { type: Number, required: true },
    category: { type: String, required: true, index: true },
    action: { type: String, required: true },
    targetId: { type: String, required: true, index: true },
    issuerId: { type: String, required: true },
    reason: { type: String, required: true },
    evidence: { type: [String], default: [] },
    metadata: { type: Schema.Types.Mixed, default: {} },
    revoked: { type: Boolean, default: false },
    revokedBy: String,
    revokedAt: Date,
    revokedReason: String,
    amendments: { type: [AmendmentSchema], default: [] },
  },
  { timestamps: true },
);
CaseSchema.index({ guildId: 1, caseId: 1 }, { unique: true });

export const CaseModel = models.Case || model('Case', CaseSchema);
