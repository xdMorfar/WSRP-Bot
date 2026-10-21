import { Schema, model, models } from 'mongoose';

const StaffProfileSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    employmentStatus: { type: String, enum: ['active', 'suspended', 'terminated', 'unknown'], default: 'unknown' },
    rehireIneligible: { type: Boolean, default: false },
    rehireReason: String,
    rehireExpiresAt: Date,
    lastKnownRankRoleId: String,
  },
  { timestamps: true },
);
StaffProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });
export const StaffProfileModel = models.StaffProfile || model('StaffProfile', StaffProfileSchema);
