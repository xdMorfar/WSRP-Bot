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

export async function buildDashboard(guildId: string) {
  const cfg = await getGuildConfig(guildId);
  const embed = await brandedEmbed(guildId, {
    title: `${cfg.branding.name} Dashboard`,
    description:
      `Welcome to **${cfg.branding.name}**. This dashboard keeps the server’s most useful information in one clear place.\n\n` +
      `Use the menu below to quickly reach the section you need.`,
    imageUrl: cfg.branding.dashboardBannerUrl || undefined,
    fields: [
      {
        name: 'Important Links',
        value: [
          validHttpUrl(cfg.server.robloxUrl) ? `[Roblox / Server Page](${cfg.server.robloxUrl})` : null,
          validHttpUrl(cfg.server.rulesUrl) ? `[Rules Page](${cfg.server.rulesUrl})` : null,
        ]
          .filter(Boolean)
          .join('\n') || 'Use the menu below for server information and regulations.',
      },
      { name: 'Regulations', value: 'Choose the correct guide from the menu below.' },
    ],
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('dashboard:section')
    .setPlaceholder('View server information…')
    .addOptions(
      { label: 'Discord Regulations', description: 'View Discord rules.', value: 'discord-rules' },
      { label: 'Game Regulations', description: 'View ER:LC in-game rules.', value: 'game-rules' },
      { label: 'Applications', description: 'View application links and status.', value: 'applications' },
      { label: 'Assistance', description: 'Open support and ticket information.', value: 'tickets' },
      { label: 'Staff Information', description: 'View staff hierarchy and information.', value: 'staff' },
      { label: 'Session Information', description: 'View current session status.', value: 'session' },
    );
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}

export async function buildApplicationsPanel(guildId: string) {
  const cfg = await getGuildConfig(guildId);
  const apps = cfg.applications ?? [];
  const embed = await brandedEmbed(guildId, {
    title: 'Applications',
    description: `Explore opportunities to join Wisconsin State Roleplay. Applications are submitted through **Melonly**; this bot only provides configured information and external links.`,
    imageUrl: cfg.branding.applicationsBannerUrl || undefined,
    fields: apps.slice(0, 10).map((a: any) => ({
      name: `${a.title} | ${a.status === 'open' ? 'Open' : 'Closed'}`,
      value: [a.description, a.requirements ? `**Requirements:** ${a.requirements}` : null, a.instructions ? `**Instructions:** ${a.instructions}` : null, a.status === 'closed' ? '**Applications are currently closed.**' : null].filter(Boolean).join('\n').slice(0, 450) || 'No details configured.',
    })),
  });
  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  if (apps.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('application:select')
      .setPlaceholder('View an application…')
      .addOptions(apps.slice(0, 25).map((a: any) => ({ label: String(a.title).slice(0, 100), description: `${a.status === 'open' ? 'Open' : 'Closed'} — view requirements and details`.slice(0, 100), value: String(a.key).slice(0, 100) })));
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

export async function buildTicketPanel(guildId: string) {
  const cfg = await getGuildConfig(guildId);
  const embed = await brandedEmbed(guildId, {
    title: `${cfg.branding.name} Assistance`,
    description: 'Our assistance system connects you with the correct support team quickly and efficiently.\n\nSelect the category that best matches what you need.',
    imageUrl: cfg.branding.assistanceBannerUrl || undefined,
    fields: (cfg.ticketCategories ?? []).slice(0, 10).map((c: any) => ({ name: String(c.label).slice(0, 100), value: String(c.description || 'Support category.').slice(0, 350) })),
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:create')
    .setPlaceholder('Select a support category…')
    .addOptions(
      (cfg.ticketCategories ?? []).slice(0, 25).map((c: any) => ({ label: c.label.slice(0, 100), description: (c.description || 'Open a ticket').slice(0, 100), value: c.key.slice(0, 100) })),
    );
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
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
  let message = existing?.messageId ? await text.messages.fetch(existing.messageId).catch(() => null) : null;
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
