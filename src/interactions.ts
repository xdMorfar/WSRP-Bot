import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type ModalSubmitInteraction,
  type TextChannel,
} from 'discord.js';
import { getGuildConfig } from './services/configService';
import { buildApplicationsPanel, buildTicketPanel, publishTrackedPanel } from './services/panelService';
import { buildSessionEmbed, addSessionVote } from './services/sessionService';
import { SessionModel } from './models/Session';
import { canUse } from './utils/permissions';
import { replyError, replyOk } from './utils/interaction';
import { parseIdList, parseColor, validHttpUrl, cleanUserText } from './utils/safe';
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

async function requireSetup(interaction: StringSelectMenuInteraction | ModalSubmitInteraction) {
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
  } else if (section === 'channels') {
    const c = cfg.channels;
    const lines = [
      ['dashboard', c.dashboardChannelId], ['announcements', c.announcementChannelId], ['ticket-panel', c.ticketPanelChannelId], ['ticket-log', c.ticketLogChannelId], ['ticket-parent', c.ticketParentCategoryId],
      ['staff-actions', c.staffActionChannelId], ['staff-log', c.staffLogChannelId], ['moderation-log', c.moderationLogChannelId], ['session', c.sessionChannelId], ['suggestions', c.suggestionsChannelId], ['welcome', c.welcomeChannelId],
    ].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('\n');
    modal.addComponents(input('channels', 'Channel IDs: key=id, one per line', TextInputStyle.Paragraph, true, 'dashboard=123...\nmoderation-log=123...\nticket-log=123...', lines, 4000));
  } else if (section === 'roles') {
    const r = cfg.roles;
    const roleLines = [
      `admins=${(r.authorizedAdminRoleIds ?? []).join(',')}`,
      `management=${(r.managementRoleIds ?? []).join(',')}`,
      `hr=${(r.hrRoleIds ?? []).join(',')}`,
      `ia=${(r.iaRoleIds ?? []).join(',')}`,
      `moderators=${(r.moderatorRoleIds ?? []).join(',')}`,
      `staff-access=${(r.staffAccessRoleIds ?? []).join(',')}`,
      `staff-divisions=${(r.staffDivisionRoleIds ?? []).join(',')}`,
      `member=${r.memberRoleId ?? ''}`,
      `loa=${r.loaRoleId ?? ''}`,
      `session-ping=${r.sessionPingRoleId ?? ''}`,
    ].join('\n');
    modal.addComponents(input('roles', 'Role IDs: key=id,id', TextInputStyle.Paragraph, true, 'management=123,456\nia=789\nmember=...', roleLines, 4000));
  } else if (section === 'rank') {
    modal.addComponents(
      input('role_id', 'Rank role ID', TextInputStyle.Short, true, '123456789012345678', undefined, 22),
      input('name', 'Rank display name', TextInputStyle.Short, true, 'Senior Moderator', undefined, 100),
      input('level', 'Rank level (higher = more authority)', TextInputStyle.Short, true, '50', undefined, 6),
    );
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
      input('support', 'Support role IDs', TextInputStyle.Short, false, '123,456', undefined, 500),
      input('restricted', 'Restricted role IDs (IA/management)', TextInputStyle.Short, false, '789', undefined, 500),
      input('questions', 'Intake questions — one per line (max 5)', TextInputStyle.Paragraph, false, 'Briefly explain what you need help with.', undefined, 2000),
      input('description', 'Category description', TextInputStyle.Paragraph, false, 'Questions and service-related assistance.', undefined, 500),
    );
  } else if (section === 'automod') {
    modal.addComponents(
      input('words', 'Blocked words/phrases — one per line', TextInputStyle.Paragraph, false, 'term1\nterm2', (cfg.automod.blockedWords ?? []).join('\n'), 2000),
      input('domains', 'Blocked domains — one per line', TextInputStyle.Paragraph, false, 'example.com', (cfg.automod.blockedDomains ?? []).join('\n'), 2000),
      input('exempt_roles', 'Exempt role IDs', TextInputStyle.Short, false, '123,456', (cfg.automod.exemptRoleIds ?? []).join(','), 1000),
      input('exempt_channels', 'Exempt channel IDs', TextInputStyle.Short, false, '123,456', (cfg.automod.exemptChannelIds ?? []).join(','), 1000),
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
  if (section === 'channels') {
    const values = kv(interaction.fields.getTextInputValue('channels'));
    const map: Record<string, string> = {
      dashboard: 'dashboardChannelId', announcements: 'announcementChannelId', 'ticket-panel': 'ticketPanelChannelId', 'ticket-log': 'ticketLogChannelId', 'ticket-parent': 'ticketParentCategoryId',
      'staff-actions': 'staffActionChannelId', 'staff-log': 'staffLogChannelId', 'moderation-log': 'moderationLogChannelId', session: 'sessionChannelId', suggestions: 'suggestionsChannelId', welcome: 'welcomeChannelId',
    };
    for (const [key, prop] of Object.entries(map)) if (values[key] && /^\d{15,22}$/.test(values[key])) (doc.channels as any)[prop] = values[key];
  }
  if (section === 'roles') {
    const values = kv(interaction.fields.getTextInputValue('roles'));
    doc.roles.authorizedAdminRoleIds = parseIdList(values.admins || '');
    doc.roles.managementRoleIds = parseIdList(values.management || '');
    doc.roles.hrRoleIds = parseIdList(values.hr || '');
    doc.roles.iaRoleIds = parseIdList(values.ia || '');
    doc.roles.moderatorRoleIds = parseIdList(values.moderators || '');
    doc.roles.staffAccessRoleIds = parseIdList(values['staff-access'] || '');
    doc.roles.staffDivisionRoleIds = parseIdList(values['staff-divisions'] || '');
    doc.roles.memberRoleId = parseIdList(values.member || '')[0];
    doc.roles.loaRoleId = parseIdList(values.loa || '')[0];
    doc.roles.sessionPingRoleId = parseIdList(values['session-ping'] || '')[0];
  }
  if (section === 'rank') {
    const roleId = interaction.fields.getTextInputValue('role_id').trim();
    const name = cleanUserText(interaction.fields.getTextInputValue('name'), 100);
    const level = Number(interaction.fields.getTextInputValue('level'));
    if (!/^\d{15,22}$/.test(roleId) || !Number.isFinite(level)) return replyError(interaction, 'Rank role ID or level is invalid.');
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
    existing.supportRoleIds = parseIdList(interaction.fields.getTextInputValue('support'));
    existing.restrictedRoleIds = parseIdList(interaction.fields.getTextInputValue('restricted'));
    if (qs.length) existing.questions = qs;
    if (desc) existing.description = desc;
  }
  if (section === 'automod') {
    doc.automod.blockedWords = interaction.fields.getTextInputValue('words').split(/\r?\n/).map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 200);
    doc.automod.blockedDomains = interaction.fields.getTextInputValue('domains').split(/\r?\n/).map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 200);
    doc.automod.exemptRoleIds = parseIdList(interaction.fields.getTextInputValue('exempt_roles'));
    doc.automod.exemptChannelIds = parseIdList(interaction.fields.getTextInputValue('exempt_channels'));
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
  if (selected === 'applications') {
    const payload = await buildApplicationsPanel(interaction.guild.id);
    return interaction.reply({ ...payload, ephemeral: true });
  }
  if (selected === 'tickets') {
    const payload = await buildTicketPanel(interaction.guild.id);
    return interaction.reply({ ...payload, ephemeral: true });
  }
  if (selected === 'session') {
    const state = (await SessionModel.findOne({ guildId: interaction.guild.id })) ?? { active: false };
    return interaction.reply({ embeds: [await buildSessionEmbed(interaction.guild.id, state)], ephemeral: true, allowedMentions: { parse: [] } });
  }
  if (selected === 'staff') {
    const ranks = [...(cfg.staffRanks ?? [])].sort((a: any, b: any) => b.level - a.level);
    const embed = await brandedEmbed(interaction.guild.id, { title: 'Staff Information / Chain of Command', description: ranks.length ? ranks.map((r: any, i: number) => `${i + 1}. <@&${r.roleId}> — **${r.name}**`).join('\n') : 'Staff hierarchy has not been configured yet.' });
    return interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
  }
  const rules = selected === 'discord-rules' ? cfg.server.discordRules : cfg.server.gameRules;
  const title = selected === 'discord-rules' ? 'Discord Regulations' : 'Game Regulations';
  const embed = await brandedEmbed(interaction.guild.id, { title, description: rules?.length ? rules.map((r: string, i: number) => `**Rule ${i + 1}**\n${r}`).join('\n\n').slice(0, 4000) : 'No rules have been configured in this section yet.' });
  return interaction.reply({ embeds: [embed], ephemeral: true });
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
    const modal = new ModalBuilder().setCustomId(`ticketadd:${ticketId}`).setTitle('Add Ticket Participant').addComponents(input('user_id', 'Discord user ID', TextInputStyle.Short, true, '123456789012345678', undefined, 22));
    return interaction.showModal(modal);
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
  if (kind === 'ticketadd') {
    const id = interaction.fields.getTextInputValue('user_id').trim();
    if (!/^\d{15,22}$/.test(id)) return replyError(interaction, 'Invalid user ID.');
    await interaction.guild.members.fetch(id).catch(() => null);
    await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    if (!ticket.participants.includes(id)) ticket.participants.push(id);
    await ticket.save();
    return replyOk(interaction, `Added <@${id}> to the ticket.`);
  }
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

export async function handleComponent(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'setup:section') return showSetupModal(interaction);
    if (interaction.customId === 'dashboard:section') return handleDashboardSelect(interaction);
    if (interaction.customId === 'application:select') return handleApplicationSelect(interaction);
    if (interaction.customId === 'ticket:create') return showTicketModal(interaction);
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
  if (interaction.customId.startsWith('ticketclose:') || interaction.customId.startsWith('ticketadd:') || interaction.customId.startsWith('tickettransfer:')) return ticketControlModal(interaction);
}
