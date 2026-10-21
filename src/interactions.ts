import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type Client,
  type GuildMember,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { getGuildConfig } from './services/configService';
import { buildApplicationsPanel, buildTicketPanel, publishTrackedPanel } from './services/panelService';
import { buildSessionEmbed, addSessionVote } from './services/sessionService';
import { SessionModel } from './models/Session';
import { canUse } from './utils/permissions';
import { replyError, replyOk } from './utils/interaction';
import { parseColor, validHttpUrl, cleanUserText } from './utils/safe';
import { GuildConfigModel } from './models/GuildConfig';
import { createTicket, canManageTicket, closeTicket } from './services/ticketService';
import { TicketModel } from './models/Ticket';
import { PendingActionModel } from './models/PendingAction';
import { terminateStaff } from './services/staffService';
import { banUser } from './services/moderationService';
import { createCase } from './services/caseService';
import { brandedEmbed } from './utils/embeds';
import { SuggestionModel } from './models/Suggestion';
import { LeaveRequestModel } from './models/LeaveRequest';
import { TimedActionModel } from './models/TimedAction';

function input(id: string, label: string, style: TextInputStyle, required = false, placeholder?: string, value?: string, maxLength?: number) {
  const b = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required);
  if (placeholder) b.setPlaceholder(placeholder.slice(0, 100));
  if (value) b.setValue(value.slice(0, maxLength ?? 4000));
  if (maxLength) b.setMaxLength(maxLength);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(b);
}

function kv(raw: string) {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return out;
}

async function requireSetup(interaction: StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction) {
  if (!interaction.guild || !interaction.member) {
    await replyError(interaction, 'This setup action can only be used in a server.');
    return false;
  }
  if (!(await canUse(interaction.member as GuildMember, 'setup'))) {
    await replyError(interaction, 'You are not authorized to change bot setup.');
    return false;
  }
  return true;
}


const CHANNEL_TARGETS: Record<string, { label: string; prop: string; category?: boolean; textOnly?: boolean }> = {
  dashboard: { label: 'Dashboard Channel', prop: 'dashboardChannelId', textOnly: true },
  applications: { label: 'Applications Channel', prop: 'applicationsChannelId', textOnly: true },
  announcements: { label: 'Announcement Channel', prop: 'announcementChannelId' },
  'ticket-panel': { label: 'Assistance / Tickets Channel', prop: 'ticketPanelChannelId', textOnly: true },
  'staff-info': { label: 'Staff Information Channel', prop: 'staffInfoChannelId', textOnly: true },
  'ticket-log': { label: 'Ticket Log Channel', prop: 'ticketLogChannelId' },
  'ticket-parent': { label: 'Ticket Parent Category', prop: 'ticketParentCategoryId', category: true },
  promotions: { label: 'Promotions Channel', prop: 'promotionChannelId' },
  infractions: { label: 'Infractions Channel', prop: 'infractionChannelId' },
  'staff-log': { label: 'Staff Log Channel', prop: 'staffLogChannelId' },
  'moderation-log': { label: 'Moderation Log Channel', prop: 'moderationLogChannelId' },
  session: { label: 'Session Channel', prop: 'sessionChannelId' },
  suggestions: { label: 'Suggestions Channel', prop: 'suggestionsChannelId' },
  welcome: { label: 'Welcome Channel', prop: 'welcomeChannelId' },
};

const ROLE_TARGETS: Record<string, { label: string; prop: string; multi: boolean }> = {
  admins: { label: 'Authorized Admin Roles', prop: 'authorizedAdminRoleIds', multi: true },
  management: { label: 'Management Roles', prop: 'managementRoleIds', multi: true },
  hr: { label: 'HR Roles', prop: 'hrRoleIds', multi: true },
  ia: { label: 'Internal Affairs Roles', prop: 'iaRoleIds', multi: true },
  moderators: { label: 'Moderator Roles', prop: 'moderatorRoleIds', multi: true },
  'staff-access': { label: 'Staff Access Roles', prop: 'staffAccessRoleIds', multi: true },
  'staff-divisions': { label: 'Staff Division Roles', prop: 'staffDivisionRoleIds', multi: true },
  member: { label: 'Member / Join Role', prop: 'memberRoleId', multi: false },
  loa: { label: 'LOA Role', prop: 'loaRoleId', multi: false },
  'session-ping': { label: 'Session Ping Role', prop: 'sessionPingRoleId', multi: false },
};

async function showChannelSetupMenu(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('setup:channel-key')
    .setPlaceholder('Choose what this channel is used for…')
    .addOptions(Object.entries(CHANNEL_TARGETS).map(([value, cfg]) => ({ label: cfg.label, value })));
  return interaction.update({
    content: '**Channels** — choose the purpose first, then Discord will let you pick the actual channel/category.',
    embeds: [],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

async function showChannelPicker(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const key = interaction.values[0];
  const target = CHANNEL_TARGETS[key];
  if (!target) return replyError(interaction, 'Unknown channel setting.');
  const picker = new ChannelSelectMenuBuilder()
    .setCustomId(`setup:channel:${key}`)
    .setPlaceholder(`Select ${target.label}…`)
    .setMinValues(1)
    .setMaxValues(1);
  picker.setChannelTypes(target.category ? [ChannelType.GuildCategory] : target.textOnly ? [ChannelType.GuildText] : [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  return interaction.update({
    content: `**${target.label}** — pick the Discord ${target.category ? 'category' : 'channel'} below.`,
    embeds: [],
    components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(picker)],
  });
}

async function saveChannelPicker(interaction: ChannelSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const key = interaction.customId.split(':')[2];
  const target = CHANNEL_TARGETS[key];
  if (!target) return replyError(interaction, 'Unknown channel setting.');
  const selected = interaction.values[0];
  const doc = await GuildConfigModel.findOneAndUpdate({ guildId: interaction.guild!.id }, { $setOnInsert: { guildId: interaction.guild!.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!doc) return replyError(interaction, 'Could not load guild configuration.');
  (doc.channels as any)[target.prop] = selected;
  await doc.save();
  return interaction.update({ content: `✅ **${target.label}** set to <#${selected}>.`, embeds: [], components: [], allowedMentions: { parse: [] } });
}

async function showRoleSetupMenu(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('setup:role-key')
    .setPlaceholder('Choose what these roles control…')
    .addOptions(Object.entries(ROLE_TARGETS).map(([value, cfg]) => ({ label: cfg.label, value })));
  return interaction.update({
    content: '**Permissions & Staff Roles** — choose a role group, then pick the actual Discord role(s).',
    embeds: [],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

async function showRolePicker(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const key = interaction.values[0];
  const target = ROLE_TARGETS[key];
  if (!target) return replyError(interaction, 'Unknown role setting.');
  const picker = new RoleSelectMenuBuilder()
    .setCustomId(`setup:role:${key}`)
    .setPlaceholder(`Select ${target.label}…`)
    .setMinValues(1)
    .setMaxValues(target.multi ? 25 : 1);
  return interaction.update({
    content: `**${target.label}** — select ${target.multi ? 'one or more Discord roles' : 'the Discord role'} below.`,
    embeds: [],
    components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(picker)],
  });
}

async function saveRolePicker(interaction: RoleSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const key = interaction.customId.split(':')[2];
  const target = ROLE_TARGETS[key];
  if (!target) return replyError(interaction, 'Unknown role setting.');
  const doc = await GuildConfigModel.findOneAndUpdate({ guildId: interaction.guild!.id }, { $setOnInsert: { guildId: interaction.guild!.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!doc) return replyError(interaction, 'Could not load guild configuration.');
  (doc.roles as any)[target.prop] = target.multi ? [...interaction.values] : interaction.values[0];
  await doc.save();
  const mentions = interaction.values.map((id) => `<@&${id}>`).join(', ');
  return interaction.update({ content: `✅ **${target.label}** set to ${mentions}.`, embeds: [], components: [], allowedMentions: { parse: [] } });
}

async function showAuthorizedAdminUsers(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const picker = new UserSelectMenuBuilder().setCustomId('setup:admin-users').setPlaceholder('Select authorized Discord users…').setMinValues(1).setMaxValues(25);
  return interaction.update({
    content: '**Authorized Admin Users** — these specific Discord users may run `/setup` even without an authorized admin role.',
    embeds: [],
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker)],
  });
}

async function saveAuthorizedAdminUsers(interaction: UserSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const doc = await GuildConfigModel.findOneAndUpdate({ guildId: interaction.guild!.id }, { $setOnInsert: { guildId: interaction.guild!.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!doc) return replyError(interaction, 'Could not load guild configuration.');
  (doc.roles as any).authorizedAdminUserIds = [...interaction.values];
  await doc.save();
  return interaction.update({ content: `✅ Authorized admin users updated: ${interaction.values.map((id) => `<@${id}>`).join(', ')}`, embeds: [], components: [], allowedMentions: { parse: [] } });
}

async function showRankRolePicker(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const picker = new RoleSelectMenuBuilder().setCustomId('setup:rank-role').setPlaceholder('Select the Discord staff rank role…').setMinValues(1).setMaxValues(1);
  return interaction.update({
    content: '**Add / Update Staff Rank** — pick the actual Discord role first.',
    embeds: [],
    components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(picker)],
  });
}

async function showRankModalFromRole(interaction: RoleSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const roleId = interaction.values[0];
  const role = interaction.guild!.roles.cache.get(roleId);
  const modal = new ModalBuilder().setCustomId(`setupmodal:rank:${roleId}`).setTitle('Setup — staff rank').addComponents(
    input('name', 'Rank display name', TextInputStyle.Short, true, 'Senior Moderator', role?.name || '', 100),
    input('level', 'Rank level (higher = more authority)', TextInputStyle.Short, true, '50', undefined, 6),
  );
  return interaction.showModal(modal);
}

async function showTicketRoleChoice(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const cfg = await getGuildConfig(interaction.guild!.id);
  const options = (cfg.ticketCategories ?? []).flatMap((cat: any) => ([
    { label: `${cat.label} — Support Roles`.slice(0, 100), value: `${cat.key}|support` },
    { label: `${cat.label} — Restricted Roles`.slice(0, 100), value: `${cat.key}|restricted` },
  ])).slice(0, 25);
  if (!options.length) return replyError(interaction, 'No ticket categories are configured yet.');
  const menu = new StringSelectMenuBuilder().setCustomId('setup:ticket-role-key').setPlaceholder('Choose ticket category and role type…').addOptions(options);
  return interaction.update({ content: '**Ticket Support Roles** — choose which ticket category you want to configure.', embeds: [], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] });
}

async function showTicketRolePicker(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const [key, kind] = interaction.values[0].split('|');
  const picker = new RoleSelectMenuBuilder().setCustomId(`setup:ticketroles:${key}:${kind}`).setPlaceholder(`Select ${kind} roles…`).setMinValues(1).setMaxValues(25);
  return interaction.update({ content: `Select the Discord **${kind}** role(s) for ticket category **${key}**.`, embeds: [], components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(picker)] });
}

async function saveTicketRoles(interaction: RoleSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const [, , key, kind] = interaction.customId.split(':');
  const doc = await GuildConfigModel.findOneAndUpdate({ guildId: interaction.guild!.id }, { $setOnInsert: { guildId: interaction.guild!.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!doc) return replyError(interaction, 'Could not load guild configuration.');
  const category = (doc.ticketCategories as any[]).find((c: any) => c.key === key);
  if (!category) return replyError(interaction, 'Ticket category no longer exists.');
  if (kind === 'support') category.supportRoleIds = [...interaction.values];
  else category.restrictedRoleIds = [...interaction.values];
  await doc.save();
  return interaction.update({ content: `✅ **${category.label}** ${kind} roles updated: ${interaction.values.map((id) => `<@&${id}>`).join(', ')}`, embeds: [], components: [], allowedMentions: { parse: [] } });
}

async function showAutomodRolePicker(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const picker = new RoleSelectMenuBuilder().setCustomId('setup:automodroles').setPlaceholder('Select AutoMod-exempt roles…').setMinValues(1).setMaxValues(25);
  return interaction.update({ content: '**AutoMod Exempt Roles** — pick the actual Discord roles.', embeds: [], components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(picker)] });
}

async function saveAutomodRoles(interaction: RoleSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const doc = await GuildConfigModel.findOneAndUpdate({ guildId: interaction.guild!.id }, { $setOnInsert: { guildId: interaction.guild!.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!doc) return replyError(interaction, 'Could not load guild configuration.');
  doc.automod.exemptRoleIds = [...interaction.values];
  await doc.save();
  return interaction.update({ content: `✅ AutoMod exempt roles updated: ${interaction.values.map((id) => `<@&${id}>`).join(', ')}`, embeds: [], components: [], allowedMentions: { parse: [] } });
}

async function showAutomodChannelPicker(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const picker = new ChannelSelectMenuBuilder().setCustomId('setup:automodchannels').setPlaceholder('Select AutoMod-exempt channels…').setMinValues(1).setMaxValues(25).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  return interaction.update({ content: '**AutoMod Exempt Channels** — pick the actual Discord channels.', embeds: [], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(picker)] });
}

async function saveAutomodChannels(interaction: ChannelSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const doc = await GuildConfigModel.findOneAndUpdate({ guildId: interaction.guild!.id }, { $setOnInsert: { guildId: interaction.guild!.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!doc) return replyError(interaction, 'Could not load guild configuration.');
  doc.automod.exemptChannelIds = [...interaction.values];
  await doc.save();
  return interaction.update({ content: `✅ AutoMod exempt channels updated: ${interaction.values.map((id) => `<#${id}>`).join(', ')}`, embeds: [], components: [], allowedMentions: { parse: [] } });
}

async function showSetupModal(interaction: StringSelectMenuInteraction) {
  if (!(await requireSetup(interaction))) return;
  const section = interaction.values[0];
  const cfg = await getGuildConfig(interaction.guild!.id);
  const modal = new ModalBuilder().setCustomId(`setupmodal:${section}`).setTitle(`Setup — ${section}`.slice(0, 45));

  if (section === 'branding') {
    modal.addComponents(
      input('name', 'Server / brand name', TextInputStyle.Short, true, 'Wisconsin State Roleplay', cfg.branding.name, 100),
      input('color', 'Primary hex color', TextInputStyle.Short, true, '#1f4f8f', `#${Number(cfg.branding.primaryColor).toString(16).padStart(6, '0')}`, 7),
      input('logo', 'Logo URL (optional)', TextInputStyle.Short, false, 'https://...', cfg.branding.logoUrl || '', 500),
      input('banners', 'Banner URLs: key=url, one per line', TextInputStyle.Paragraph, false, 'dashboard=https://...\nassistance=https://...\napplications=https://...\nstaff=https://...', [cfg.branding.dashboardBannerUrl ? `dashboard=${cfg.branding.dashboardBannerUrl}` : '', cfg.branding.assistanceBannerUrl ? `assistance=${cfg.branding.assistanceBannerUrl}` : '', cfg.branding.applicationsBannerUrl ? `applications=${cfg.branding.applicationsBannerUrl}` : '', cfg.branding.staffBannerUrl ? `staff=${cfg.branding.staffBannerUrl}` : ''].filter(Boolean).join('\n'), 2000),
      input('footer', 'Footer text', TextInputStyle.Short, false, 'Powered by Wisconsin State Roleplay', cfg.branding.footerText || '', 200),
    );
  } else if (section === 'channels' || section === 'roles' || section === 'rank' || section === 'admin-users' || section === 'ticket-roles' || section === 'automod-roles' || section === 'automod-channels') {
    return replyError(interaction, 'Use the Discord selector shown in setup for this section.');
  } else if (section === 'server') {
    modal.addComponents(
      input('server_name', 'ER:LC private server name', TextInputStyle.Short, true, 'Wisconsin State Roleplay', cfg.server.privateServerName || '', 100),
      input('join_code', 'ER:LC join code', TextInputStyle.Short, false, 'ABC123', cfg.server.joinCode || '', 100),
      input('roblox_url', 'Roblox/server URL (optional)', TextInputStyle.Short, false, 'https://www.roblox.com/...', cfg.server.robloxUrl || '', 500),
      input('rules_url', 'External rules URL (optional)', TextInputStyle.Short, false, 'https://...', cfg.server.rulesUrl || '', 500),
      input('welcome', 'Welcome message; use {user}', TextInputStyle.Paragraph, false, 'Welcome {user} to **Wisconsin State Roleplay**.', cfg.welcomeMessage || '', 1000),
    );
  } else if (section === 'rules') {
    modal.addComponents(
      input('discord_rules', 'Discord rules — one rule per line', TextInputStyle.Paragraph, false, 'Respect all members.\nUse channels correctly.\nNo NSFW content.', (cfg.server.discordRules ?? []).join('\n'), 4000),
      input('game_rules', 'In-game rules — one rule per line', TextInputStyle.Paragraph, false, 'Follow ER:LC roleplay rules.\nNo RDM/VDM.\nFollow staff instructions.', (cfg.server.gameRules ?? []).join('\n'), 4000),
    );
  } else if (section === 'application') {
    modal.addComponents(
      input('key', 'Application key', TextInputStyle.Short, true, 'staff', undefined, 50),
      input('title', 'Title', TextInputStyle.Short, true, 'Staff Applications', undefined, 100),
      input('description', 'Description', TextInputStyle.Paragraph, true, 'Apply to join our staff team.', undefined, 1000),
      input('requirements', 'Requirements', TextInputStyle.Paragraph, true, 'Read all requirements before applying.', undefined, 1000),
      input('settings', 'status/url/button: key=value', TextInputStyle.Paragraph, true, 'status=open\nurl=https://melonly...\nbutton=Apply on Melonly', undefined, 1500),
    );
  } else if (section === 'ticket') {
    modal.addComponents(
      input('key', 'Category key | Display label', TextInputStyle.Short, true, 'general|General Support', undefined, 180),
      input('questions', 'Intake questions — one per line (max 5)', TextInputStyle.Paragraph, false, 'Briefly explain what you need help with.', undefined, 2000),
      input('description', 'Category description', TextInputStyle.Paragraph, false, 'Questions and service-related assistance.', undefined, 500),
    );
  } else if (section === 'automod') {
    modal.addComponents(
      input('words', 'Blocked words/phrases — one per line', TextInputStyle.Paragraph, false, 'term1\nterm2', (cfg.automod.blockedWords ?? []).join('\n'), 2000),
      input('domains', 'Blocked domains — one per line', TextInputStyle.Paragraph, false, 'example.com', (cfg.automod.blockedDomains ?? []).join('\n'), 2000),
      input('thresholds', 'Thresholds: key=value', TextInputStyle.Paragraph, false, 'spam=6\nwindow=8\nmentions=6\ntimeout=10\nrapidjoins=8', `spam=${cfg.automod.spamMessages}\nwindow=${cfg.automod.spamWindowSeconds}\nmentions=${cfg.automod.mentionLimit}\ntimeout=${cfg.automod.timeoutMinutes}\nrapidjoins=${cfg.automod.rapidJoinCount}`, 1000),
    );
  } else if (section === 'limits') {
    modal.addComponents(
      input('max_tickets', 'Max open tickets per user', TextInputStyle.Short, true, '2', String(cfg.limits.maxOpenTickets), 4),
      input('ticket_cooldown', 'Ticket creation cooldown seconds', TextInputStyle.Short, true, '60', String(cfg.limits.ticketCooldownSeconds), 8),
      input('inactivity_hours', 'Ticket auto-close inactivity hours', TextInputStyle.Short, true, '72', String(cfg.limits.ticketInactivityHours), 8),
      input('vote_threshold', 'Vote threshold | cooldown hours', TextInputStyle.Short, true, '5|6', `${cfg.limits.sessionVoteThreshold}|${cfg.limits.sessionVoteCooldownHours ?? 6}`, 20),
      input('retention', 'Retention days: key=value', TextInputStyle.Paragraph, true, 'tickets=90\nevidence=180\nstaff=365', `tickets=${cfg.retention.ticketDays}\nevidence=${cfg.retention.evidenceDays}\nstaff=${cfg.retention.staffRecordDays}`, 500),
    );
  } else {
    return replyError(interaction, 'Unknown setup section.');
  }
  await interaction.showModal(modal);
}

async function saveSetupModal(interaction: ModalSubmitInteraction) {
  if (!(await requireSetup(interaction))) return;
  const section = interaction.customId.split(':')[1];
  const doc = await GuildConfigModel.findOneAndUpdate({ guildId: interaction.guild!.id }, { $setOnInsert: { guildId: interaction.guild!.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!doc) return replyError(interaction, 'Could not load guild configuration.');

  if (section === 'branding') {
    doc.branding.name = interaction.fields.getTextInputValue('name');
    doc.branding.primaryColor = parseColor(interaction.fields.getTextInputValue('color'), doc.branding.primaryColor);
    const logo = interaction.fields.getTextInputValue('logo').trim();
    doc.branding.logoUrl = validHttpUrl(logo) ? logo : undefined;
    const banners = kv(interaction.fields.getTextInputValue('banners'));
    doc.branding.dashboardBannerUrl = validHttpUrl(banners.dashboard) ? banners.dashboard : undefined;
    doc.branding.assistanceBannerUrl = validHttpUrl(banners.assistance) ? banners.assistance : undefined;
    doc.branding.applicationsBannerUrl = validHttpUrl(banners.applications) ? banners.applications : undefined;
    doc.branding.staffBannerUrl = validHttpUrl(banners.staff) ? banners.staff : undefined;
    doc.branding.footerText = cleanUserText(interaction.fields.getTextInputValue('footer'), 200) || 'Powered by Wisconsin State Roleplay';
  }
  if (section === 'rank') {
    const roleId = interaction.customId.split(':')[2];
    const name = cleanUserText(interaction.fields.getTextInputValue('name'), 100);
    const level = Number(interaction.fields.getTextInputValue('level'));
    if (!roleId || !interaction.guild!.roles.cache.has(roleId) || !Number.isFinite(level)) return replyError(interaction, 'Rank role or level is invalid.');
    const existing = (doc.staffRanks as any[]).find((r: any) => r.roleId === roleId);
    if (existing) Object.assign(existing, { name, level });
    else (doc.staffRanks as any[]).push({ roleId, name, level });
    doc.staffRanks.sort((a: any, b: any) => a.level - b.level);
  }
  if (section === 'server') {
    doc.server.privateServerName = cleanUserText(interaction.fields.getTextInputValue('server_name'), 100);
    doc.server.joinCode = cleanUserText(interaction.fields.getTextInputValue('join_code'), 100) || undefined;
    const roblox = interaction.fields.getTextInputValue('roblox_url').trim();
    const rules = interaction.fields.getTextInputValue('rules_url').trim();
    doc.server.robloxUrl = validHttpUrl(roblox) ? roblox : undefined;
    doc.server.rulesUrl = validHttpUrl(rules) ? rules : undefined;
    doc.welcomeMessage = cleanUserText(interaction.fields.getTextInputValue('welcome'), 1000) || doc.welcomeMessage;
  }
  if (section === 'rules') {
    doc.server.discordRules = interaction.fields.getTextInputValue('discord_rules').split(/\r?\n/).map((x) => cleanUserText(x.trim(), 500)).filter(Boolean).slice(0, 50);
    doc.server.gameRules = interaction.fields.getTextInputValue('game_rules').split(/\r?\n/).map((x) => cleanUserText(x.trim(), 500)).filter(Boolean).slice(0, 50);
  }
  if (section === 'application') {
    const key = interaction.fields.getTextInputValue('key').toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 50);
    const settings = kv(interaction.fields.getTextInputValue('settings'));
    const status = settings.status === 'open' ? 'open' : 'closed';
    if (status === 'open' && !validHttpUrl(settings.url)) return replyError(interaction, 'A valid URL is required when an application is open.');
    const apps = doc.applications as any[];
    const existing = apps.find((a) => a.key === key);
    const next = { key, title: cleanUserText(interaction.fields.getTextInputValue('title'), 100), description: cleanUserText(interaction.fields.getTextInputValue('description'), 1000), requirements: cleanUserText(interaction.fields.getTextInputValue('requirements'), 1000), status, url: validHttpUrl(settings.url) ? settings.url : undefined, buttonLabel: cleanUserText(settings.button || 'Apply on Melonly', 80) };
    if (existing) Object.assign(existing, next); else apps.push(next);
  }
  if (section === 'ticket') {
    const raw = interaction.fields.getTextInputValue('key').trim();
    const [rawKey, rawLabel] = raw.split('|');
    const key = rawKey.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 80);
    if (!key) return replyError(interaction, 'Ticket category key is invalid.');
    const categories = doc.ticketCategories as any[];
    let existing = categories.find((c) => c.key === key);
    const qs = interaction.fields.getTextInputValue('questions').split(/\r?\n/).map((x) => cleanUserText(x.trim(), 100)).filter(Boolean).slice(0, 5);
    const desc = cleanUserText(interaction.fields.getTextInputValue('description'), 500);
    if (!existing) {
      const label = cleanUserText(rawLabel?.trim() || key.split('-').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' '), 100);
      existing = { key, label, description: desc || 'Support category.', supportRoleIds: [], restrictedRoleIds: [], questions: qs.length ? qs : ['Briefly explain what you need help with.'] } as any;
      categories.push(existing);
    }
    if (rawLabel?.trim()) existing.label = cleanUserText(rawLabel.trim(), 100);
    if (qs.length) existing.questions = qs;
    if (desc) existing.description = desc;
  }
  if (section === 'automod') {
    doc.automod.blockedWords = interaction.fields.getTextInputValue('words').split(/\r?\n/).map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 200);
    doc.automod.blockedDomains = interaction.fields.getTextInputValue('domains').split(/\r?\n/).map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 200);
    const t = kv(interaction.fields.getTextInputValue('thresholds'));
    const n = (key: string, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Number(t[key]) || fallback));
    doc.automod.spamMessages = n('spam', doc.automod.spamMessages, 3, 30);
    doc.automod.spamWindowSeconds = n('window', doc.automod.spamWindowSeconds, 2, 60);
    doc.automod.mentionLimit = n('mentions', doc.automod.mentionLimit, 2, 50);
    doc.automod.timeoutMinutes = n('timeout', doc.automod.timeoutMinutes, 0, 10080);
    doc.automod.rapidJoinCount = n('rapidjoins', doc.automod.rapidJoinCount, 3, 100);
  }
  if (section === 'limits') {
    const clamp = (raw: string, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Number(raw) || fallback));
    doc.limits.maxOpenTickets = clamp(interaction.fields.getTextInputValue('max_tickets'), doc.limits.maxOpenTickets, 1, 20);
    doc.limits.ticketCooldownSeconds = clamp(interaction.fields.getTextInputValue('ticket_cooldown'), doc.limits.ticketCooldownSeconds, 0, 86400);
    doc.limits.ticketInactivityHours = clamp(interaction.fields.getTextInputValue('inactivity_hours'), doc.limits.ticketInactivityHours, 1, 24 * 365);
    const voteParts = interaction.fields.getTextInputValue('vote_threshold').split('|').map((x) => x.trim());
    doc.limits.sessionVoteThreshold = clamp(voteParts[0] || '', doc.limits.sessionVoteThreshold, 1, 10000);
    doc.limits.sessionVoteCooldownHours = clamp(voteParts[1] || '', doc.limits.sessionVoteCooldownHours ?? 6, 1, 168);
    const r = kv(interaction.fields.getTextInputValue('retention'));
    doc.retention.ticketDays = clamp(r.tickets || '', doc.retention.ticketDays, 1, 3650);
    doc.retention.evidenceDays = clamp(r.evidence || '', doc.retention.evidenceDays, 1, 3650);
    doc.retention.staffRecordDays = clamp(r.staff || '', doc.retention.staffRecordDays, 1, 3650);
  }
  await doc.save();
  await replyOk(interaction, `Setup section **${section}** saved. Run /validate after completing setup.`);
}

async function handleDashboardSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild) return replyError(interaction, 'Server context unavailable.');
  const cfg = await getGuildConfig(interaction.guild.id);
  const selected = interaction.values[0];

  if (selected === 'discord-rules' || selected === 'game-rules') {
    if (!validHttpUrl(cfg.server.rulesUrl)) return replyError(interaction, 'The rules website has not been configured yet.');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Rules Website').setURL(cfg.server.rulesUrl),
    );
    return interaction.reply({ content: 'Server regulations are hosted on the official rules website.', components: [row], ephemeral: true });
  }

  const channels: Record<string, { id?: string; label: string }> = {
    applications: { id: cfg.channels.applicationsChannelId, label: 'Applications' },
    tickets: { id: cfg.channels.ticketPanelChannelId, label: 'Assistance' },
    staff: { id: cfg.channels.staffInfoChannelId, label: 'Staff Information' },
    session: { id: cfg.channels.sessionChannelId, label: 'Sessions' },
  };
  const target = channels[selected];
  if (!target?.id) return replyError(interaction, `${target?.label || 'That section'} channel is not configured yet.`);
  return interaction.reply({ content: `Go to **${target.label}**: <#${target.id}>`, ephemeral: true, allowedMentions: { parse: [] } });
}


async function handleApplicationSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild) return replyError(interaction, 'Server context unavailable.');
  const cfg = await getGuildConfig(interaction.guild.id);
  const app = (cfg.applications ?? []).find((a: any) => a.key === interaction.values[0]);
  if (!app) return replyError(interaction, 'That application entry no longer exists.');
  const embed = await brandedEmbed(interaction.guild.id, {
    title: `${app.title} | ${app.status === 'open' ? 'Open' : 'Closed'}`,
    description: app.description || 'Application information.',
    imageUrl: validHttpUrl(app.imageUrl) ? app.imageUrl : undefined,
    fields: [
      { name: 'Requirements', value: String(app.requirements || 'No additional requirements configured.').slice(0, 1024) },
      ...(app.instructions ? [{ name: 'Instructions', value: String(app.instructions).slice(0, 1024) }] : []),
      { name: 'Status', value: app.status === 'open' ? 'Applications are currently open.' : 'Applications are currently closed.' },
    ],
  });
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (app.status === 'open' && validHttpUrl(app.url)) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(app.buttonLabel || 'Apply on Melonly').setURL(app.url)));
  }
  return interaction.reply({ embeds: [embed], components, ephemeral: true });
}

async function showTicketModal(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild || !interaction.member) return replyError(interaction, 'Server context unavailable.');
  const cfg = await getGuildConfig(interaction.guild.id);
  const key = interaction.values[0];
  const category = (cfg.ticketCategories ?? []).find((c: any) => c.key === key);
  if (!category) return replyError(interaction, 'That ticket category is not configured.');
  const modal = new ModalBuilder().setCustomId(`ticketmodal:${key}`).setTitle(category.label.slice(0, 45));
  const questions = (category.questions?.length ? category.questions : ['Briefly explain what you need help with.']).slice(0, 5);
  questions.forEach((q: string, i: number) => modal.addComponents(input(`q${i}`, q, TextInputStyle.Paragraph, true, 'Enter your answer…', undefined, 1000)));
  await interaction.showModal(modal);
}

async function submitTicketModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guild || !interaction.member) return replyError(interaction, 'Server context unavailable.');
  const key = interaction.customId.slice('ticketmodal:'.length);
  const cfg = await getGuildConfig(interaction.guild.id);
  const category = (cfg.ticketCategories ?? []).find((c: any) => c.key === key);
  if (!category) return replyError(interaction, 'Ticket category no longer exists.');
  const questions = (category.questions?.length ? category.questions : ['Briefly explain what you need help with.']).slice(0, 5);
  const answers = questions.map((_: string, i: number) => interaction.fields.getTextInputValue(`q${i}`));
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await createTicket({ guild: interaction.guild, creator: interaction.member as GuildMember, categoryKey: key, answers });
    await interaction.editReply({ content: `✅ Ticket #${result.ticketId} created: ${result.channel}` });
  } catch (e: any) {
    await interaction.editReply({ content: `❌ ${e.message}` });
  }
}

async function ticketButton(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.member) return replyError(interaction, 'Server context unavailable.');
  const [_, action, rawId] = interaction.customId.split(':');
  const ticketId = Number(rawId);
  const ticket = await TicketModel.findOne({ guildId: interaction.guild.id, ticketId, status: 'open' });
  if (!ticket) return replyError(interaction, 'This ticket is no longer open.');
  const member = interaction.member as GuildMember;
  if (action === 'close') {
    if (member.id !== ticket.creatorId && !(await canManageTicket(member, ticket))) return replyError(interaction, 'You are not authorized to close this ticket.');
    const modal = new ModalBuilder().setCustomId(`ticketclose:${ticketId}`).setTitle(`Close Ticket #${ticketId}`).addComponents(input('reason', 'Closure reason', TextInputStyle.Paragraph, true, 'Resolved / no response / duplicate…', undefined, 800));
    return interaction.showModal(modal);
  }
  if (!(await canManageTicket(member, ticket))) return replyError(interaction, 'Only the assigned support team can use this control.');
  if (action === 'claim') {
    if (ticket.claimedBy && ticket.claimedBy !== member.id) return replyError(interaction, `Already claimed by <@${ticket.claimedBy}>.`);
    ticket.claimedBy = member.id; await ticket.save();
    return replyOk(interaction, 'Ticket claimed.');
  }
  if (action === 'add') {
    const picker = new UserSelectMenuBuilder().setCustomId(`ticketadd:${ticketId}`).setPlaceholder('Select a Discord user to add…').setMinValues(1).setMaxValues(1);
    return interaction.reply({ content: 'Choose the Discord user you want to add to this ticket.', components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker)], ephemeral: true });
  }
  if (action === 'transfer') {
    const modal = new ModalBuilder().setCustomId(`tickettransfer:${ticketId}`).setTitle('Transfer Ticket').addComponents(input('category', 'Configured category key', TextInputStyle.Short, true, 'general / staff-report / appeal', undefined, 100));
    return interaction.showModal(modal);
  }
}

async function ticketControlModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guild || !interaction.member) return replyError(interaction, 'Server context unavailable.');
  const [kind, rawId] = interaction.customId.split(':');
  const ticketId = Number(rawId);
  const ticket = await TicketModel.findOne({ guildId: interaction.guild.id, ticketId, status: 'open' });
  if (!ticket) return replyError(interaction, 'Ticket is no longer open.');
  const member = interaction.member as GuildMember;
  if (kind === 'ticketclose') {
    await interaction.deferReply({ ephemeral: true });
    try {
      await closeTicket({ guild: interaction.guild, ticketId, actor: member, reason: interaction.fields.getTextInputValue('reason') });
      return interaction.editReply({ content: '✅ Ticket closed and transcript created when a ticket log channel is configured.' });
    } catch (e: any) { return interaction.editReply({ content: `❌ ${e.message}` }); }
  }
  if (!(await canManageTicket(member, ticket))) return replyError(interaction, 'Only the assigned support team can use this control.');
  const channel = interaction.guild.channels.cache.get(ticket.channelId);
  if (!channel || !('permissionOverwrites' in channel)) return replyError(interaction, 'Ticket channel is unavailable.');
  if (kind === 'tickettransfer') {
    const key = interaction.fields.getTextInputValue('category').trim().toLowerCase();
    const cfg = await getGuildConfig(interaction.guild.id);
    const category = (cfg.ticketCategories ?? []).find((c: any) => c.key === key);
    if (!category) return replyError(interaction, 'Unknown configured ticket category key.');
    const oldCategory = (cfg.ticketCategories ?? []).find((c: any) => c.key === ticket.categoryKey);
    for (const id of [...(oldCategory?.supportRoleIds ?? []), ...(oldCategory?.restrictedRoleIds ?? [])]) await channel.permissionOverwrites.delete(id).catch(() => undefined);
    const nextRoles = [...new Set([...(category.supportRoleIds ?? []), ...(category.restrictedRoleIds ?? []), ...(category.key === 'staff-report' ? (cfg.roles.iaRoleIds ?? []) : []), ...(category.key === 'staff-report' ? (cfg.roles.managementRoleIds ?? []) : [])])];
    for (const id of nextRoles) await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageMessages: true }).catch(() => undefined);
    ticket.categoryKey = key; await ticket.save();
    return replyOk(interaction, `Ticket transferred to **${category.label}**.`);
  }
}


async function ticketAddUserSelect(interaction: UserSelectMenuInteraction) {
  if (!interaction.guild || !interaction.member) return replyError(interaction, 'Server context unavailable.');
  const ticketId = Number(interaction.customId.split(':')[1]);
  const ticket = await TicketModel.findOne({ guildId: interaction.guild.id, ticketId, status: 'open' });
  if (!ticket) return replyError(interaction, 'Ticket is no longer open.');
  const member = interaction.member as GuildMember;
  if (!(await canManageTicket(member, ticket))) return replyError(interaction, 'Only the assigned support team can use this control.');
  const channel = interaction.guild.channels.cache.get(ticket.channelId);
  if (!channel || !('permissionOverwrites' in channel)) return replyError(interaction, 'Ticket channel is unavailable.');
  const id = interaction.values[0];
  const selectedMember = await interaction.guild.members.fetch(id).catch(() => null);
  if (!selectedMember) return replyError(interaction, 'That user is not in this server.');
  await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  if (!ticket.participants.includes(id)) ticket.participants.push(id);
  await ticket.save();
  return interaction.update({ content: `✅ Added <@${id}> to ticket #${ticketId}.`, components: [], allowedMentions: { parse: [] } });
}

function customPanelPayload(data: any) {
  const embed = new EmbedBuilder().setTitle(data.title).setDescription(data.description).setColor(data.color ?? 0x1f4f8f);
  if (data.footer) embed.setFooter({ text: data.footer });
  if (validHttpUrl(data.imageUrl)) embed.setImage(data.imageUrl);
  if (validHttpUrl(data.thumbnailUrl)) embed.setThumbnail(data.thumbnailUrl);
  if (data.fields?.length) embed.addFields(data.fields.slice(0, 25));
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < (data.buttons ?? []).length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const b of data.buttons.slice(i, i + 5)) if (validHttpUrl(b.url)) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(b.label).setURL(b.url));
    if (row.components.length) rows.push(row);
  }
  return { embeds: [embed], components: rows.slice(0, 5) };
}

async function pendingButton(interaction: ButtonInteraction) {
  const [_, action, token] = interaction.customId.split(':');
  const pending = await PendingActionModel.findOne({ token });
  if (!pending || pending.expiresAt < new Date()) return replyError(interaction, 'This confirmation has expired.');
  if (pending.actorId !== interaction.user.id) return replyError(interaction, 'Only the user who created this action can confirm it.');
  if (action === 'cancel') {
    pending.consumedAt = new Date(); await pending.save();
    return interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
  }
  if (!interaction.guild || !interaction.member) return replyError(interaction, 'Server context unavailable.');
  const claimed = await PendingActionModel.findOneAndUpdate({ token, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: new Date() } }, { new: true });
  if (!claimed) return replyError(interaction, 'This action was already processed or expired.');
  await interaction.deferUpdate();
  try {
    if (claimed.kind === 'staff-termination') {
      const target = await interaction.guild.members.fetch(claimed.payload.targetId).catch(() => null);
      if (!target) throw new Error('Target staff member is no longer in the server.');
      const record = await terminateStaff({ guild: interaction.guild, actor: interaction.member as GuildMember, target, reason: claimed.payload.reason, evidence: claimed.payload.evidence ?? [], rehireIneligible: !!claimed.payload.rehireIneligible, rehireExpiresAt: claimed.payload.rehireExpiresAt ? new Date(claimed.payload.rehireExpiresAt) : undefined });
      return interaction.editReply({ content: `✅ Staff termination completed. Case #${record.caseId}.`, embeds: [], components: [] });
    }
    if (claimed.kind === 'discord-ban') {
      if (!(await canUse(interaction.member as GuildMember, 'moderation'))) throw new Error('Your configured moderation permission was removed before confirmation.');
      const target = await interaction.client.users.fetch(claimed.payload.targetId);
      const record = await banUser(interaction.guild, interaction.member as GuildMember, target, claimed.payload.reason, claimed.payload.deleteMessageSeconds ?? 0);
      return interaction.editReply({ content: `✅ Discord ban completed. Case #${record.caseId}.`, embeds: [], components: [] });
    }
    if (claimed.kind === 'purge') {
      if (!(await canUse(interaction.member as GuildMember, 'moderation'))) throw new Error('Your configured moderation permission was removed before confirmation.');
      const channel = interaction.guild.channels.cache.get(claimed.payload.channelId);
      if (!channel || !('bulkDelete' in channel)) throw new Error('The target channel no longer supports bulk deletion.');
      const textChannel = channel as TextChannel;
      const messages = await textChannel.messages.fetch({ limit: Math.min(100, Number(claimed.payload.amount) + 20) });
      const selected = claimed.payload.userId ? messages.filter((m: any) => m.author.id === claimed.payload.userId).first(claimed.payload.amount) : messages.first(claimed.payload.amount);
      const deleted = await textChannel.bulkDelete(selected as any, true);
      const rec = await createCase({
        guildId: interaction.guild.id,
        category: 'discord-moderation',
        action: 'purge',
        targetId: channel.id,
        issuerId: interaction.user.id,
        reason: cleanUserText(claimed.payload.reason || 'Large purge', 500),
        metadata: { requested: claimed.payload.amount, deleted: deleted.size, filteredUserId: claimed.payload.userId ?? null },
      });
      return interaction.editReply({ content: `✅ Deleted ${deleted.size} messages. Case #${rec.caseId}.`, embeds: [], components: [] });
    }
    if (claimed.kind === 'announcement') {
      if (!(await canUse(interaction.member as GuildMember, 'management'))) throw new Error('Your configured management permission was removed before confirmation.');
      const channel = interaction.guild.channels.cache.get(claimed.payload.channelId);
      if (!channel?.isTextBased()) throw new Error('Announcement channel no longer exists.');
      const embed = await brandedEmbed(interaction.guild.id, { title: claimed.payload.title, description: claimed.payload.message });
      await channel.send({ content: claimed.payload.pingRoleId ? `<@&${claimed.payload.pingRoleId}>` : undefined, embeds: [embed], allowedMentions: { roles: claimed.payload.pingRoleId ? [claimed.payload.pingRoleId] : [] } });
      return interaction.editReply({ content: '✅ Announcement published.', embeds: [], components: [] });
    }
    if (claimed.kind === 'custom-panel') {
      if (!(await canUse(interaction.member as GuildMember, 'management'))) throw new Error('Your configured management permission was removed before confirmation.');
      const payload = customPanelPayload(claimed.payload.data);
      await publishTrackedPanel({ guild: interaction.guild, key: claimed.payload.key, type: 'custom', channelId: claimed.payload.channelId, payload, actorId: interaction.user.id, data: claimed.payload.data });
      return interaction.editReply({ content: `✅ Panel \`${claimed.payload.key}\` published or updated.`, embeds: [], components: [] });
    }
    throw new Error('Unsupported confirmation action.');
  } catch (e: any) {
    await PendingActionModel.updateOne({ token }, { $unset: { consumedAt: 1 } }).catch(() => undefined);
    return interaction.editReply({ content: `❌ ${e.message}`, embeds: [], components: [] });
  }
}

async function suggestionVote(interaction: ButtonInteraction) {
  if (!interaction.guild) return replyError(interaction, 'Server context unavailable.');
  const [_, direction, rawId] = interaction.customId.split(':');
  const id = Number(rawId);
  if (!id) return replyError(interaction, 'Invalid suggestion ID.');
  const update = direction === 'up'
    ? { $pull: { downvotes: interaction.user.id }, $addToSet: { upvotes: interaction.user.id } }
    : { $pull: { upvotes: interaction.user.id }, $addToSet: { downvotes: interaction.user.id } };
  const suggestion = await SuggestionModel.findOneAndUpdate({ guildId: interaction.guild.id, suggestionId: id }, update, { new: true });
  if (!suggestion) return replyError(interaction, 'Suggestion no longer exists.');
  const embed = await brandedEmbed(interaction.guild.id, { title: `Suggestion #${id}`, description: suggestion.content, fields: [{ name: 'Status', value: suggestion.status.replace(/\b\w/g, (m: string) => m.toUpperCase()), inline: true }, { name: 'Votes', value: `👍 ${suggestion.upvotes.length}   •   👎 ${suggestion.downvotes.length}`, inline: true }] });
  await interaction.update({ embeds: [embed] });
}

async function loaButton(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.member) return replyError(interaction, 'Server context unavailable.');
  if (!(await canUse(interaction.member as GuildMember, 'hr'))) return replyError(interaction, 'HR/management permission is required.');
  const [_, decision, rawId] = interaction.customId.split(':');
  const requestId = Number(rawId);
  const req = await LeaveRequestModel.findOneAndUpdate({ guildId: interaction.guild.id, requestId, status: 'pending' }, { $set: { status: decision === 'approve' ? 'approved' : 'denied', handledBy: interaction.user.id, handledAt: new Date() } }, { new: true });
  if (!req) return replyError(interaction, 'This LOA request was already handled or no longer exists.');
  if (decision === 'approve') {
    const cfg = await getGuildConfig(interaction.guild.id);
    const member = await interaction.guild.members.fetch(req.userId).catch(() => null);
    if (member && cfg.roles.loaRoleId) await member.roles.add(cfg.roles.loaRoleId, `LOA #${requestId} approved`).catch(() => undefined);
    await TimedActionModel.create({ guildId: interaction.guild.id, userId: req.userId, type: 'loa', executeAt: req.endAt, payload: { requestId } });
    await member?.send(`Your LOA request #${requestId} in **${interaction.guild.name}** was approved until <t:${Math.floor(new Date(req.endAt).getTime() / 1000)}:F>.`).catch(() => undefined);
  } else {
    const member = await interaction.guild.members.fetch(req.userId).catch(() => null);
    await member?.send(`Your LOA request #${requestId} in **${interaction.guild.name}** was denied.`).catch(() => undefined);
  }
  await interaction.update({ content: `LOA #${requestId}: **${req.status}** by <@${interaction.user.id}>.`, components: [], allowedMentions: { parse: [] } });
}

export async function handleComponent(interaction: ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | UserSelectMenuInteraction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'setup:section') {
      const section = interaction.values[0];
      if (section === 'channels') return showChannelSetupMenu(interaction);
      if (section === 'roles') return showRoleSetupMenu(interaction);
      if (section === 'admin-users') return showAuthorizedAdminUsers(interaction);
      if (section === 'rank') return showRankRolePicker(interaction);
      if (section === 'ticket-roles') return showTicketRoleChoice(interaction);
      if (section === 'automod-roles') return showAutomodRolePicker(interaction);
      if (section === 'automod-channels') return showAutomodChannelPicker(interaction);
      return showSetupModal(interaction);
    }
    if (interaction.customId === 'setup:channel-key') return showChannelPicker(interaction);
    if (interaction.customId === 'setup:role-key') return showRolePicker(interaction);
    if (interaction.customId === 'setup:ticket-role-key') return showTicketRolePicker(interaction);
    if (interaction.customId === 'dashboard:section') return handleDashboardSelect(interaction);
    if (interaction.customId === 'application:select') return handleApplicationSelect(interaction);
    if (interaction.customId === 'ticket:create') return showTicketModal(interaction);
  }
  if (interaction.isChannelSelectMenu()) {
    if (interaction.customId.startsWith('setup:channel:')) return saveChannelPicker(interaction);
    if (interaction.customId === 'setup:automodchannels') return saveAutomodChannels(interaction);
  }
  if (interaction.isRoleSelectMenu()) {
    if (interaction.customId.startsWith('setup:role:')) return saveRolePicker(interaction);
    if (interaction.customId === 'setup:rank-role') return showRankModalFromRole(interaction);
    if (interaction.customId.startsWith('setup:ticketroles:')) return saveTicketRoles(interaction);
    if (interaction.customId === 'setup:automodroles') return saveAutomodRoles(interaction);
  }
  if (interaction.isUserSelectMenu()) {
    if (interaction.customId === 'setup:admin-users') return saveAuthorizedAdminUsers(interaction);
    if (interaction.customId.startsWith('ticketadd:')) return ticketAddUserSelect(interaction);
  }
  if (interaction.isButton()) {
    if (interaction.customId === 'session:vote') {
      if (!interaction.guild) return replyError(interaction, 'Server context unavailable.');
      try { const result = await addSessionVote(interaction.guild, interaction.user.id); return interaction.reply({ content: `✅ Session vote: **${result.count}/${result.threshold}**.`, ephemeral: true }); } catch (e: any) { return replyError(interaction, e.message); }
    }
    if (interaction.customId.startsWith('ticket:')) return ticketButton(interaction);
    if (interaction.customId.startsWith('pending:')) return pendingButton(interaction);
    if (interaction.customId.startsWith('suggest:')) return suggestionVote(interaction);
    if (interaction.customId.startsWith('loa:')) return loaButton(interaction);
  }
}

export async function handleModal(interaction: ModalSubmitInteraction) {
  if (interaction.customId.startsWith('setupmodal:')) return saveSetupModal(interaction);
  if (interaction.customId.startsWith('ticketmodal:')) return submitTicketModal(interaction);
  if (interaction.customId.startsWith('ticketclose:') || interaction.customId.startsWith('tickettransfer:')) return ticketControlModal(interaction);
}
