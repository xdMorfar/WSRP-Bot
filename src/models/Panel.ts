import { Schema, model, models } from 'mongoose';

const PanelSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    type: { type: String, required: true },
    channelId: String,
    messageId: String,
    data: { type: Schema.Types.Mixed, default: {} },
    published: { type: Boolean, default: false },
    template: { type: Boolean, default: false },
    createdBy: String,
    updatedBy: String,
  },
  { timestamps: true },
);
PanelSchema.index({ guildId: 1, key: 1 }, { unique: true });
export const PanelModel = models.Panel || model('Panel', PanelSchema);
