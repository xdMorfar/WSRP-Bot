import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, type TextChannel } from 'discord.js';
import type { BotCommand } from '../types';
import { TicketModel } from '../models/Ticket';
import { canManageTicket, closeTicket, createTicket, ticketAccessRoleIds } from '../services/ticketService';
import { replyError, replyOk } from '../utils/interaction';
import { getGuildConfig } from '../services/configService';

export const ticketCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket management commands.')
    .addSubcommand((s) => s.setName('close').setDescription('Close the current ticket.').addStringOption((o) => o.setName('reason').setDescription('Closure reason').setRequired(true).setMaxLength(800)))
    .addSubcommand((s) => s.setName('claim').setDescription('Claim the current ticket.'))
    .addSubcommand((s) => s.setName('unclaim').setDescription('Unclaim the current ticket.'))
    .addSubcommand((s) => s.setName('add').setDescription('Add a participant to the current ticket.').addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a participant from the current ticket.').addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('transfer').setDescription('Transfer the current ticket to another configured category.').addStringOption((o) => o.setName('category').setDescription('Configured category key').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('followup').setDescription('Create a linked follow-up to a closed ticket.').addIntegerOption((o) => o.setName('id').setDescription('Closed ticket ID').setRequired(true).setMinValue(1))),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    const member = interaction.member as GuildMember;
    const sub = interaction.options.getSubcommand();
    if (sub === 'followup') {
      const id = interaction.options.getInteger('id', true);
      const previous = await TicketModel.findOne({ guildId: interaction.guild.id, ticketId: id, status: 'closed' });
      if (!previous) return replyError(interaction, 'Closed ticket not found.');
      if (previous.creatorId !== member.id && !(await canManageTicket(member, previous))) return replyError(interaction, 'You are not authorized to create a follow-up for that ticket.');
      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await createTicket({ guild: interaction.guild, creator: member, categoryKey: previous.categoryKey, answers: [`Follow-up to closed ticket #${id}.`] });
        await interaction.editReply({ content: `✅ Follow-up ticket #${result.ticketId} created: ${result.channel}` });
      } catch (e: any) {
        await interaction.editReply({ content: `❌ ${e.message}` });
      }
      return;
    }
    if (!interaction.channel) return replyError(interaction, 'Use this command inside an open ticket channel.');
    const ticketChannel = interaction.channel as TextChannel;
    const ticket = await TicketModel.findOne({ guildId: interaction.guild.id, channelId: ticketChannel.id, status: 'open' });
    if (!ticket) return replyError(interaction, 'This channel is not an open bot-managed ticket.');
    if (sub === 'close') {
      await interaction.deferReply({ ephemeral: true });
      try {
        await closeTicket({ guild: interaction.guild, ticketId: ticket.ticketId, actor: member, reason: interaction.options.getString('reason', true) });
        await interaction.editReply({ content: '✅ Ticket closed and transcript processing started.' });
      } catch (e: any) {
        await interaction.editReply({ content: `❌ ${e.message}` });
      }
      return;
    }
    if (!(await canManageTicket(member, ticket))) return replyError(interaction, 'Only the assigned support team can manage this ticket.');
    if (sub === 'claim') {
      if (ticket.claimedBy && ticket.claimedBy !== member.id) return replyError(interaction, `This ticket is already claimed by <@${ticket.claimedBy}>.`);
      ticket.claimedBy = member.id;
      await ticket.save();
      return replyOk(interaction, 'Ticket claimed.');
    }
    if (sub === 'unclaim') {
      if (ticket.claimedBy && ticket.claimedBy !== member.id) return replyError(interaction, 'Only the current claimant can unclaim this ticket.');
      ticket.claimedBy = undefined;
      await ticket.save();
      return replyOk(interaction, 'Ticket unclaimed.');
    }
    const user = interaction.options.getUser('user');
    if (sub === 'add' && user) {
      await ticketChannel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      if (!ticket.participants.includes(user.id)) ticket.participants.push(user.id);
      await ticket.save();
      return replyOk(interaction, `Added ${user.tag} to the ticket.`);
    }
    if (sub === 'remove' && user) {
      if (user.id === ticket.creatorId) return replyError(interaction, 'The ticket creator cannot be removed.');
      await ticketChannel.permissionOverwrites.delete(user.id).catch(() => undefined);
      ticket.participants = ticket.participants.filter((id: string) => id !== user.id);
      await ticket.save();
      return replyOk(interaction, `Removed ${user.tag} from the ticket.`);
    }
    if (sub === 'transfer') {
      const categoryKey = interaction.options.getString('category', true).toLowerCase();
      const cfg = await getGuildConfig(interaction.guild.id);
      const next = (cfg.ticketCategories ?? []).find((c: any) => c.key === categoryKey);
      if (!next) return replyError(interaction, 'Unknown configured ticket category key.');
      const previous = (cfg.ticketCategories ?? []).find((c: any) => c.key === ticket.categoryKey);
      const previousRoles = ticketAccessRoleIds(cfg, previous);
      const nextRoles = ticketAccessRoleIds(cfg, next);
      for (const id of previousRoles.filter((roleId: string) => !nextRoles.includes(roleId))) await ticketChannel.permissionOverwrites.delete(id).catch(() => undefined);
      for (const id of nextRoles) await ticketChannel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageMessages: true }).catch(() => undefined);
      ticket.categoryKey = categoryKey;
      await ticket.save();
      return replyOk(interaction, `Ticket transferred to **${next.label}**.`);
    }
  },
};
