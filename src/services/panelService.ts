import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  StringSelectMenuBuilder,
  type Guild,
  type GuildTextBasedChannel,
} from 'discord.js';
import { PanelModel } from '../models/Panel';
import { getGuildConfig } from './configService';
import { brandedEmbed } from '../utils/embeds';
import { validHttpUrl } from '../utils/safe';

function discordChannelUrl(guildId: string, channelId?: string | null) {
  return channelId ? `https://discord.com/channels/${guildId}/${channelId}` : null;
}

function linkRows(buttons: ButtonBuilder[]) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(i, i + 5)));
  }
  return rows.slice(0, 5);
}

export async function buildDashboard(guildId: string) {
  const cfg = await getGuildConfig(guildId);
  const embed = await brandedEmbed(guildId, {
    title: `${cfg.branding.name} Dashboard`,
    description: `Welcome to **${cfg.branding.name}**. Choose an option below to continue.`,
    imageUrl: cfg.branding.dashboardBannerUrl || undefined,
    showDefaultThumbnail: false,
  });

  const buttons: ButtonBuilder[] = [];
  if (validHttpUrl(cfg.server.rulesUrl)) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Rules').setURL(cfg.server.rulesUrl));
  }
  const applications = discordChannelUrl(guildId, cfg.channels.applicationsChannelId);
  if (applications) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Applications').setURL(applications));
  const assistance = discordChannelUrl(guildId, cfg.channels.ticketPanelChannelId);
  if (assistance) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Assistance').setURL(assistance));
  const staff = discordChannelUrl(guildId, cfg.channels.staffInfoChannelId);
  if (staff) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Staff').setURL(staff));
  const session = discordChannelUrl(guildId, cfg.channels.sessionChannelId);
  if (session) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Sessions').setURL(session));
  if (validHttpUrl(cfg.server.robloxUrl)) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Roblox').setURL(cfg.server.robloxUrl));
  }

  return { embeds: [embed], components: linkRows(buttons) };
}

export async function buildApplicationsPanel(guildId: string) {
  const cfg = await getGuildConfig(guildId);
  const apps = cfg.applications ?? [];
  const lines = apps.slice(0, 10).map((a: any) => {
    const status = a.status === 'open' ? 'Open' : 'Closed';
    const detail = a.description ? ` — ${a.description}` : '';
    return `**${a.title}** · ${status}${detail}`;
  });
  const embed = await brandedEmbed(guildId, {
    title: 'Applications',
    description:
      `Applications for **${cfg.branding.name}** are handled through **Melonly**. Choose an application below to view its requirements and current status.\n\n` +
      (lines.length ? lines.join('\n') : 'No application panels are configured yet.'),
    imageUrl: cfg.branding.applicationsBannerUrl || undefined,
    showDefaultThumbnail: false,
  });

  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  if (apps.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('application:select')
      .setPlaceholder('View an application…')
      .addOptions(apps.slice(0, 25).map((a: any) => ({
        label: String(a.title).slice(0, 100),
        description: `${a.status === 'open' ? 'Open' : 'Closed'} — view requirements and details`.slice(0, 100),
        value: String(a.key).slice(0, 100),
      })));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }

  let row = new ActionRowBuilder<ButtonBuilder>();
  for (const app of apps) {
    if (app.status !== 'open' || !validHttpUrl(app.url)) continue;
    if (row.components.length >= 5) {
      rows.push(row);
      row = new ActionRowBuilder<ButtonBuilder>();
    }
    row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(app.buttonLabel || app.title).setURL(app.url));
  }
  if (row.components.length) rows.push(row);
  return { embeds: [embed], components: rows.slice(0, 5) };
}

function uniqueTicketCategories(categories: any[]) {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const category of categories ?? []) {
    const identity = String(category.key || category.label || '').trim().toLowerCase();
    const labelIdentity = String(category.label || '').trim().toLowerCase();
    if (!identity || seen.has(identity) || (labelIdentity && seen.has(`label:${labelIdentity}`))) continue;
    seen.add(identity);
    if (labelIdentity) seen.add(`label:${labelIdentity}`);
    result.push(category);
  }
  return result;
}

export async function buildTicketPanel(guildId: string) {
  const cfg = await getGuildConfig(guildId);
  const categories = uniqueTicketCategories(cfg.ticketCategories ?? []);
  const categorySummary = categories
    .slice(0, 10)
    .map((c: any) => `**${c.label}** — ${c.description || 'Open a support ticket.'}`)
    .join('\n');

  const embed = await brandedEmbed(guildId, {
    title: `${cfg.branding.name} Assistance`,
    description:
      `Need help? Select the support category that best matches your issue from the menu below.\n\n` +
      `${categorySummary || 'No support categories are configured yet.'}\n\n` +
      `A private ticket will be created for you and the appropriate support team.`,
    imageUrl: cfg.branding.assistanceBannerUrl || undefined,
    showDefaultThumbnail: false,
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:create')
    .setPlaceholder('Select a support category…')
    .addOptions(
      categories.slice(0, 25).map((c: any) => ({
        label: String(c.label).slice(0, 100),
        description: String(c.description || 'Open a ticket').slice(0, 100),
        value: String(c.key).slice(0, 100),
      })),
    );

  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

export async function buildStaffPanel(guildId: string) {
  const cfg = await getGuildConfig(guildId);
  const ranks = [...(cfg.staffRanks ?? [])].sort((a: any, b: any) => b.level - a.level);
  const hierarchy = ranks.length
    ? ranks.map((r: any) => `<@&${r.roleId}>`).join('\n')
    : 'The staff hierarchy has not been configured yet.';

  const embed = await brandedEmbed(guildId, {
    title: 'Staff Information',
    description:
      `Official staff information for **${cfg.branding.name}**.\n\n` +
      `**Chain of Command**\n${hierarchy}\n\n` +
      `Promotions and disciplinary actions are posted separately in their configured staff channels.`,
    imageUrl: cfg.branding.staffBannerUrl || undefined,
    showDefaultThumbnail: false,
  });
  return { embeds: [embed], components: [] };
}

export async function publishTrackedPanel(input: {
  guild: Guild;
  key: string;
  type: string;
  channelId: string;
  payload: any;
  actorId: string;
  data?: Record<string, unknown>;
}) {
  const channel = input.guild.channels.cache.get(input.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Destination must be a standard text channel.');
  const text = channel as GuildTextBasedChannel;
  const existing = await PanelModel.findOne({ guildId: input.guild.id, key: input.key });

  // If the configured destination changed, remove the old tracked panel so the
  // same panel does not remain duplicated in two different channels.
  if (existing?.messageId && existing.channelId && existing.channelId !== input.channelId) {
    const oldChannel = input.guild.channels.cache.get(existing.channelId);
    if (oldChannel?.isTextBased()) {
      const oldMessage = await oldChannel.messages.fetch(existing.messageId).catch(() => null);
      if (oldMessage) await oldMessage.delete().catch(() => undefined);
    }
  }

  let message = existing?.channelId === input.channelId && existing?.messageId
    ? await text.messages.fetch(existing.messageId).catch(() => null)
    : null;
  if (message) await message.edit(input.payload);
  else message = await text.send({ ...input.payload, allowedMentions: { parse: [] } });

  await PanelModel.findOneAndUpdate(
    { guildId: input.guild.id, key: input.key },
    {
      $set: {
        type: input.type,
        channelId: input.channelId,
        messageId: message.id,
        data: input.data ?? {},
        published: true,
        updatedBy: input.actorId,
      },
      $setOnInsert: { createdBy: input.actorId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return message;
}
