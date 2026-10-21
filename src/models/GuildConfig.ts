import { Schema, model, models } from 'mongoose';
import { BRAND, DEFAULT_APPLICATIONS, DEFAULT_TICKET_CATEGORIES } from '../constants';

const RankSchema = new Schema(
  { roleId: { type: String, required: true }, name: { type: String, required: true }, level: { type: Number, required: true } },
  { _id: false },
);

const TicketCategorySchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: '' },
    supportRoleIds: { type: [String], default: [] },
    restrictedRoleIds: { type: [String], default: [] },
    questions: { type: [String], default: [] },
  },
  { _id: false },
);

const ApplicationSchema = new Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    requirements: { type: String, default: '' },
    instructions: { type: String },
    status: { type: String, enum: ['open', 'closed'], default: 'closed' },
    url: { type: String },
    buttonLabel: { type: String, default: 'Apply on Melonly' },
    imageUrl: { type: String },
  },
  { _id: false },
);

const GuildConfigSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    branding: {
      name: { type: String, default: BRAND.defaultName },
      primaryColor: { type: Number, default: BRAND.primary },
      successColor: { type: Number, default: BRAND.success },
      warningColor: { type: Number, default: BRAND.warning },
      dangerColor: { type: Number, default: BRAND.danger },
      logoUrl: { type: String },
      dashboardBannerUrl: { type: String },
      assistanceBannerUrl: { type: String },
      applicationsBannerUrl: { type: String },
      staffBannerUrl: { type: String },
      footerText: { type: String, default: 'Powered by Wisconsin State Roleplay' },
    },
    roles: {
      authorizedAdminRoleIds: { type: [String], default: [] },
      managementRoleIds: { type: [String], default: [] },
      hrRoleIds: { type: [String], default: [] },
      iaRoleIds: { type: [String], default: [] },
      moderatorRoleIds: { type: [String], default: [] },
      staffAccessRoleIds: { type: [String], default: [] },
      staffDivisionRoleIds: { type: [String], default: [] },
      memberRoleId: { type: String },
      loaRoleId: { type: String },
      sessionPingRoleId: { type: String },
    },
    staffRanks: { type: [RankSchema], default: [] },
    channels: {
      announcementChannelId: { type: String },
      ticketPanelChannelId: { type: String },
      ticketLogChannelId: { type: String },
      ticketParentCategoryId: { type: String },
      staffActionChannelId: { type: String },
      moderationLogChannelId: { type: String },
      sessionChannelId: { type: String },
      suggestionsChannelId: { type: String },
      welcomeChannelId: { type: String },
      staffLogChannelId: { type: String },
      dashboardChannelId: { type: String },
    },
    server: {
      privateServerName: { type: String, default: 'Wisconsin State Roleplay' },
      joinCode: { type: String },
      discordRules: { type: [String], default: [] },
      gameRules: { type: [String], default: [] },
      rulesUrl: { type: String },
      robloxUrl: { type: String },
    },
    applications: { type: [ApplicationSchema], default: () => DEFAULT_APPLICATIONS.map((x) => ({ ...x })) },
    ticketCategories: { type: [TicketCategorySchema], default: () => DEFAULT_TICKET_CATEGORIES.map((x) => ({ ...x, supportRoleIds: [...x.supportRoleIds], restrictedRoleIds: [...x.restrictedRoleIds], questions: [...x.questions] })) },
    automod: {
      enabled: { type: Boolean, default: true },
      spamEnabled: { type: Boolean, default: true },
      spamMessages: { type: Number, default: 6 },
      spamWindowSeconds: { type: Number, default: 8 },
      repeatEnabled: { type: Boolean, default: true },
      repeatCount: { type: Number, default: 4 },
      mentionSpamEnabled: { type: Boolean, default: true },
      mentionLimit: { type: Number, default: 6 },
      invitesEnabled: { type: Boolean, default: true },
      blockedWords: { type: [String], default: [] },
      blockedDomains: { type: [String], default: [] },
      exemptRoleIds: { type: [String], default: [] },
      exemptChannelIds: { type: [String], default: [] },
      timeoutMinutes: { type: Number, default: 10 },
      rapidJoinEnabled: { type: Boolean, default: true },
      rapidJoinCount: { type: Number, default: 8 },
      rapidJoinWindowSeconds: { type: Number, default: 20 },
    },
    economy: {
      enabled: { type: Boolean, default: false },
      currencyName: { type: String, default: 'Credits' },
      dailyAmount: { type: Number, default: 250 },
      workMin: { type: Number, default: 50 },
      workMax: { type: Number, default: 150 },
    },
    limits: {
      maxOpenTickets: { type: Number, default: 2 },
      ticketCooldownSeconds: { type: Number, default: 60 },
      ticketInactivityHours: { type: Number, default: 72 },
      sessionVoteThreshold: { type: Number, default: 5 },
      sessionVoteCooldownHours: { type: Number, default: 6 },
    },
    retention: {
      ticketDays: { type: Number, default: 90 },
      evidenceDays: { type: Number, default: 180 },
      staffRecordDays: { type: Number, default: 365 },
    },
    welcomeMessage: {
      type: String,
      default: 'Welcome to **Wisconsin State Roleplay**, {user}. Please review the rules and use the dashboard if you need help.',
    },
    timezone: { type: String, default: 'America/Chicago' },
  },
  { timestamps: true },
);

export const GuildConfigModel = models.GuildConfig || model('GuildConfig', GuildConfigSchema);
