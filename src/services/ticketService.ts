import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { nextSequence } from '../models/Counter';
import { TicketModel } from '../models/Ticket';
import { getGuildConfig } from './configService';
import { brandedEmbed } from '../utils/embeds';
import { cleanUserText } from '../utils/safe';
import { canUse } from '../utils/permissions';


export function ticketAccessRoleIds(cfg: any, category: any): string[] {
  const staffReport = category?.key === 'staff-report';
  return [...new Set([
    ...(staffReport ? [] : (category?.supportRoleIds ?? [])),
    ...(category?.restrictedRoleIds ?? []),
    ...(staffReport ? (cfg.roles.iaRoleIds ?? []) : []),
    ...(staffReport ? (cfg.roles.managementRoleIds ?? []) : []),
    ...(staffReport ? (cfg.roles.authorizedAdminRoleIds ?? []) : []),
  ])];
}

export async function createTicket(input: { guild: Guild; creator: GuildMember; categoryKey: string; answers: string[] }) {
  const cfg = await getGuildConfig(input.guild.id);
  const category = (cfg.ticketCategories ?? []).find((c: any) => c.key === input.categoryKey);
  if (!category) throw new Error('That ticket category is no longer configured.');

  const open = await TicketModel.countDocuments({ guildId: input.guild.id, creatorId: input.creator.id, status: 'open' });
  if (open >= cfg.limits.maxOpenTickets) throw new Error(`You already have the maximum of ${cfg.limits.maxOpenTickets} open tickets.`);

  const latest = await TicketModel.findOne({ guildId: input.guild.id, creatorId: input.creator.id }).sort({ createdAt: -1 });
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < cfg.limits.ticketCooldownSeconds * 1000) {
    throw new Error('Please wait before opening another ticket.');
  }

  const ticketId = await nextSequence(`ticket:${input.guild.id}`);
  const supportRoles = ticketAccessRoleIds(cfg, category);
  const permissionOverwrites: any[] = [
    { id: input.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: input.creator.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    ...supportRoles.map((id: string) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] })),
  ];
  if (input.guild.members.me) {
    permissionOverwrites.push({ id: input.guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] });
  }

  const channel = await input.guild.channels.create({
    name: `ticket-${String(ticketId).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent: cfg.channels.ticketParentCategoryId || undefined,
    topic: `WSRP ticket #${ticketId} | Creator: ${input.creator.id} | Category: ${category.key}`,
    permissionOverwrites,
    reason: `Ticket #${ticketId} created by ${input.creator.user.tag}`,
  });

  const answerText = input.answers
    .map((answer, i) => `**${category.questions?.[i] || `Question ${i + 1}`}**\n${cleanUserText(answer, 1000)}`)
    .join('\n\n');
  const embed = await brandedEmbed(input.guild.id, {
    title: category.label,
    description:
      `Your ticket has been created successfully. Please wait for an authorized support member to respond.\n\n` +
      `${answerText || 'No intake answers were provided.'}\n\n` +
      `**Claimed by:** Unclaimed`,
  });
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${ticketId}`).setLabel('Claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:close:${ticketId}`).setLabel('Close').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ticket:add:${ticketId}`).setLabel('Add User').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:transfer:${ticketId}`).setLabel('Transfer').setStyle(ButtonStyle.Secondary),
  );
  await channel.send({ content: `${input.creator}${supportRoles.map((r: string) => `<@&${r}>`).join(' ')}`, embeds: [embed], components: [controls], allowedMentions: { users: [input.creator.id], roles: supportRoles } });

  await TicketModel.create({
    guildId: input.guild.id,
    ticketId,
    creatorId: input.creator.id,
    channelId: channel.id,
    categoryKey: category.key,
    answers: input.answers.map((x) => cleanUserText(x, 1000)),
    participants: [input.creator.id],
    lastActivityAt: new Date(),
  });
  return { ticketId, channel };
}

export async function canManageTicket(member: GuildMember, ticket: any) {
  if (await canUse(member, 'management')) return true;
  const cfg = await getGuildConfig(member.guild.id);
  const category = (cfg.ticketCategories ?? []).find((c: any) => c.key === ticket.categoryKey);
  const roleIds = ticketAccessRoleIds(cfg, category);
  return roleIds.some((id: string) => member.roles.cache.has(id));
}

function esc(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

async function transcript(channel: TextChannel) {
  const all: any[] = [];
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const rows = all.map((m) => `<div class="msg"><div><strong>${esc(m.author?.tag || 'Unknown')}</strong> <span>${new Date(m.createdTimestamp).toISOString()}</span></div><pre>${esc(m.content || '')}</pre>${[...m.attachments.values()].map((a: any) => `<div>Attachment: ${esc(a.url)}</div>`).join('')}</div>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket transcript</title><style>body{font-family:Arial,sans-serif;background:#111827;color:#e5e7eb;padding:24px}.msg{border-bottom:1px solid #374151;padding:12px 0}.msg span{color:#9ca3af;font-size:12px}pre{white-space:pre-wrap;font-family:inherit}</style></head><body><h1>${esc(channel.name)}</h1>${rows}</body></html>`;
}

export async function closeTicket(input: { guild: Guild; ticketId: number; actor: GuildMember; reason: string; force?: boolean }) {
  const ticket = await TicketModel.findOne({ guildId: input.guild.id, ticketId: input.ticketId, status: 'open' });
  if (!ticket) throw new Error('Open ticket not found.');
  if (!input.force && input.actor.id !== ticket.creatorId && !(await canManageTicket(input.actor, ticket))) throw new Error('You are not authorized to close this ticket.');
  const channel = input.guild.channels.cache.get(ticket.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Ticket channel no longer exists.');
  const html = await transcript(channel as TextChannel);
  const cfg = await getGuildConfig(input.guild.id);
  const logChannel = cfg.channels.ticketLogChannelId ? input.guild.channels.cache.get(cfg.channels.ticketLogChannelId) : null;
  let transcriptMessageId: string | undefined;
  if (logChannel?.isTextBased()) {
    const file = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `ticket-${input.ticketId}.html` });
    const logEmbed = await brandedEmbed(input.guild.id, { title: `Ticket #${input.ticketId} Closed`, description: `Creator: <@${ticket.creatorId}>\nClosed by: <@${input.actor.id}>\nReason: ${cleanUserText(input.reason, 800)}` });
    const sent = await logChannel.send({ embeds: [logEmbed], files: [file], allowedMentions: { parse: [] } });
    transcriptMessageId = sent.id;
  }
  ticket.status = 'closed';
  ticket.closedAt = new Date();
  ticket.closedBy = input.actor.id;
  ticket.closeReason = cleanUserText(input.reason, 800);
  ticket.transcriptMessageId = transcriptMessageId;
  await ticket.save();
  await (channel as TextChannel).send({ content: `Ticket closed by <@${input.actor.id}>. This channel will be deleted in 5 seconds.`, allowedMentions: { parse: [] } }).catch(() => undefined);
  setTimeout(() => (channel as TextChannel).delete(`Ticket #${input.ticketId} closed`).catch(() => undefined), 5000);
  return ticket;
}
