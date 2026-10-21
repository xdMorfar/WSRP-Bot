import { randomUUID } from 'crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { BotCommand } from '../types';
import { getGuildConfig } from '../services/configService';
import { SuggestionModel } from '../models/Suggestion';
import { nextSequence } from '../models/Counter';
import { brandedEmbed } from '../utils/embeds';
import { replyError, replyOk } from '../utils/interaction';
import { canUse } from '../utils/permissions';
import { cleanUserText } from '../utils/safe';
import { LeaveRequestModel } from '../models/LeaveRequest';
import { TimedActionModel } from '../models/TimedAction';
import { ShiftModel } from '../models/Shift';
import { PendingActionModel } from '../models/PendingAction';

export const suggestCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('suggest').setDescription('Submit a server suggestion.').addStringOption((o) => o.setName('suggestion').setDescription('Your suggestion').setRequired(true).setMaxLength(1800)),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return replyError(interaction, 'This command can only be used in a server.');
    const cfg = await getGuildConfig(interaction.guild.id);
    const channel = cfg.channels.suggestionsChannelId ? interaction.guild.channels.cache.get(cfg.channels.suggestionsChannelId) : null;
    if (!channel?.isTextBased()) return replyError(interaction, 'The suggestions channel is not configured.');
    const suggestionId = await nextSequence(`suggestion:${interaction.guild.id}`);
    const content = cleanUserText(interaction.options.getString('suggestion', true), 1800);
    const embed = await brandedEmbed(interaction.guild.id, { title: `Suggestion #${suggestionId}`, description: content, fields: [{ name: 'Status', value: 'Pending', inline: true }, { name: 'Votes', value: '👍 0   •   👎 0', inline: true }] });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`suggest:up:${suggestionId}`).setLabel('Upvote').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`suggest:down:${suggestionId}`).setLabel('Downvote').setStyle(ButtonStyle.Secondary),
    );
    const message = await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
    await SuggestionModel.create({ guildId: interaction.guild.id, suggestionId, authorId: interaction.user.id, content, channelId: channel.id, messageId: message.id });
    await replyOk(interaction, `Suggestion #${suggestionId} submitted.`);
  },
};

export const suggestionCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('suggestion').setDescription('Manage suggestion statuses.').addSubcommand((s) => s.setName('status').setDescription('Change a suggestion status.').addIntegerOption((o) => o.setName('id').setDescription('Suggestion ID').setRequired(true).setMinValue(1)).addStringOption((o) => o.setName('status').setDescription('New status').setRequired(true).addChoices({ name: 'Pending', value: 'pending' }, { name: 'Planned', value: 'planned' }, { name: 'Accepted', value: 'accepted' }, { name: 'Declined', value: 'declined' }, { name: 'Implemented', value: 'implemented' }))),
  async execute(interaction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    if (!(await canUse(interaction.member as GuildMember, 'management'))) return replyError(interaction, 'Management permission is required.');
    const id = interaction.options.getInteger('id', true);
    const status = interaction.options.getString('status', true);
    const suggestion = await SuggestionModel.findOne({ guildId: interaction.guild.id, suggestionId: id });
    if (!suggestion) return replyError(interaction, 'Suggestion not found.');
    suggestion.status = status;
    await suggestion.save();
    const channel = suggestion.channelId ? interaction.guild.channels.cache.get(suggestion.channelId) : null;
    const message = channel?.isTextBased() && suggestion.messageId ? await channel.messages.fetch(suggestion.messageId).catch(() => null) : null;
    if (message) {
      const embed = await brandedEmbed(interaction.guild.id, { title: `Suggestion #${id}`, description: suggestion.content, fields: [{ name: 'Status', value: status.replace(/\b\w/g, (m: string) => m.toUpperCase()), inline: true }, { name: 'Votes', value: `👍 ${suggestion.upvotes.length}   •   👎 ${suggestion.downvotes.length}`, inline: true }] });
      await message.edit({ embeds: [embed] }).catch(() => undefined);
    }
    await replyOk(interaction, `Suggestion #${id} set to ${status}.`);
  },
};

export const loaCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('loa')
    .setDescription('Staff leave-of-absence requests.')
    .addSubcommand((s) => s.setName('request').setDescription('Request leave of absence.').addIntegerOption((o) => o.setName('days').setDescription('Number of days').setRequired(true).setMinValue(1).setMaxValue(180)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)))
    .addSubcommand((s) => s.setName('status').setDescription('View your recent LOA requests.')),
  async execute(interaction) {
    if (!interaction.guild) return replyError(interaction, 'This command can only be used in a server.');
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const requests = await LeaveRequestModel.find({ guildId: interaction.guild.id, userId: interaction.user.id }).sort({ createdAt: -1 }).limit(10);
      const embed = await brandedEmbed(interaction.guild.id, { title: 'Leave of Absence', description: requests.length ? requests.map((r: any) => `#${r.requestId} • **${r.status}** • <t:${Math.floor(new Date(r.startAt).getTime() / 1000)}:d> → <t:${Math.floor(new Date(r.endAt).getTime() / 1000)}:d>`).join('\n') : 'No LOA requests found.' });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const days = interaction.options.getInteger('days', true);
    const reason = cleanUserText(interaction.options.getString('reason', true), 1000);
    const cfg = await getGuildConfig(interaction.guild.id);
    const channelId = cfg.channels.staffLogChannelId || cfg.channels.staffActionChannelId;
    const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
    if (!channel?.isTextBased()) return replyError(interaction, 'No staff log/action channel is configured for LOA review.');
    const requestId = await nextSequence(`loa:${interaction.guild.id}`);
    const startAt = new Date();
    const endAt = new Date(Date.now() + days * 86_400_000);
    const embed = await brandedEmbed(interaction.guild.id, { title: `LOA Request #${requestId}`, description: `Staff Member: <@${interaction.user.id}>\nDuration: **${days} day(s)**\nEnds: <t:${Math.floor(endAt.getTime() / 1000)}:F>\n\n**Reason**\n${reason}` });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`loa:approve:${requestId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`loa:deny:${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    );
    const sent = await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
    await LeaveRequestModel.create({ guildId: interaction.guild.id, requestId, userId: interaction.user.id, startAt, endAt, reason, messageId: sent.id, channelId: sent.channelId });
    await replyOk(interaction, `LOA request #${requestId} submitted for review.`);
  },
};

export const shiftCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('shift').setDescription('Persistent staff shift clock.').addSubcommand((s) => s.setName('clockin').setDescription('Clock in.')).addSubcommand((s) => s.setName('clockout').setDescription('Clock out.')).addSubcommand((s) => s.setName('status').setDescription('View current shift status.')),
  async execute(interaction) {
    if (!interaction.guild) return replyError(interaction, 'This command can only be used in a server.');
    const sub = interaction.options.getSubcommand();
    const open = await ShiftModel.findOne({ guildId: interaction.guild.id, userId: interaction.user.id, clockOutAt: { $exists: false } }).sort({ clockInAt: -1 });
    if (sub === 'clockin') {
      if (open) return replyError(interaction, `You are already clocked in since <t:${Math.floor(new Date(open.clockInAt).getTime() / 1000)}:R>.`);
      await ShiftModel.create({ guildId: interaction.guild.id, userId: interaction.user.id, clockInAt: new Date() });
      return replyOk(interaction, 'Clocked in.');
    }
    if (sub === 'clockout') {
      if (!open) return replyError(interaction, 'You are not currently clocked in.');
      open.clockOutAt = new Date();
      open.durationSeconds = Math.max(0, Math.floor((open.clockOutAt.getTime() - new Date(open.clockInAt).getTime()) / 1000));
      await open.save();
      return replyOk(interaction, `Clocked out after ${Math.floor(open.durationSeconds / 3600)}h ${Math.floor((open.durationSeconds % 3600) / 60)}m.`);
    }
    if (open) return interaction.reply({ content: `You are clocked in since <t:${Math.floor(new Date(open.clockInAt).getTime() / 1000)}:R>.`, ephemeral: true });
    return interaction.reply({ content: 'You are currently clocked out.', ephemeral: true });
  },
};

export const remindCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('remind').setDescription('Create a private persistent reminder.').addIntegerOption((o) => o.setName('minutes').setDescription('Minutes from now').setRequired(true).setMinValue(1).setMaxValue(525600)).addStringOption((o) => o.setName('message').setDescription('Reminder text').setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!interaction.guild) return replyError(interaction, 'This command can only be used in a server.');
    const minutes = interaction.options.getInteger('minutes', true);
    await TimedActionModel.create({ guildId: interaction.guild.id, userId: interaction.user.id, type: 'reminder', executeAt: new Date(Date.now() + minutes * 60_000), payload: { message: cleanUserText(interaction.options.getString('message', true), 1000) } });
    await replyOk(interaction, `Reminder set for <t:${Math.floor((Date.now() + minutes * 60_000) / 1000)}:R>.`);
  },
};

export const announcementCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Preview and publish a professional server announcement.')
    .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('message').setDescription('Announcement message').setRequired(true).setMaxLength(3500))
    .addChannelOption((o) => o.setName('channel').setDescription('Destination channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((o) => o.setName('ping_role').setDescription('Optional role to mention')),
  async execute(interaction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    if (!(await canUse(interaction.member as GuildMember, 'management'))) return replyError(interaction, 'Management permission is required.');
    const channel = interaction.options.getChannel('channel', true);
    const ping = interaction.options.getRole('ping_role');
    const token = randomUUID();
    const payload = { title: cleanUserText(interaction.options.getString('title', true), 200), message: cleanUserText(interaction.options.getString('message', true), 3500), channelId: channel.id, pingRoleId: ping?.id ?? null };
    await PendingActionModel.create({ token, guildId: interaction.guild.id, actorId: interaction.user.id, kind: 'announcement', payload, expiresAt: new Date(Date.now() + 10 * 60_000) });
    const embed = await brandedEmbed(interaction.guild.id, { title: payload.title, description: payload.message });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`pending:confirm:${token}`).setLabel('Publish').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`pending:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    await interaction.reply({ content: `Preview — destination <#${channel.id}>${ping ? `, ping <@&${ping.id}>` : ''}`, embeds: [embed], components: [row], ephemeral: true, allowedMentions: { parse: [] } });
  },
};

export const helpCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show commands relevant to you.'),
  async execute(interaction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    const member = interaction.member as GuildMember;
    const isMod = await canUse(member, 'moderation');
    const isIA = await canUse(member, 'ia');
    const isHR = await canUse(member, 'hr');
    const isMgmt = await canUse(member, 'management');
    const commands = [
      '**Everyone:** `/dashboard` (staff publish only), `/session status`, `/session vote`, `/suggest`, `/shift`, `/loa`, `/remind`, `/balance`, `/daily`, `/work`, `/pay` (economy only when enabled)',
      ...(isMod ? ['**Moderation:** `/warn`, `/warnings`, `/kick`, `/ban`, `/unban`, `/timeout`, `/untimeout`, `/purge`, `/slowmode`, `/lock`, `/unlock`, `/case`'] : []),
      ...(isIA ? ['**Internal Affairs:** `/staff infraction`, `/staff history`, case amendments/revocation'] : []),
      ...(isHR ? ['**HR:** `/staff promote`, `/staff demote`, `/staff profile`, `/staff hierarchy`'] : []),
      ...(isMgmt ? ['**Management:** `/setup`, `/validate`, `/dashboard publish`, `/announcement`, `/lockdown`, `/session start`, `/session end`, `/application`, `/embed`, `/automod`, `/suggestion status`'] : []),
    ];
    const embed = await brandedEmbed(interaction.guild.id, { title: 'Wisconsin State Roleplay Bot — Help', description: commands.join('\n\n') });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export const utilityCommands: BotCommand[] = [suggestCommand, suggestionCommand, loaCommand, shiftCommand, remindCommand, announcementCommand, helpCommand];
