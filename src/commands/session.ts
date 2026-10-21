import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import type { BotCommand } from '../types';
import { addSessionVote, buildSessionEmbed, endSession, startSession } from '../services/sessionService';
import { SessionModel } from '../models/Session';
import { replyError } from '../utils/interaction';

export const sessionCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('session')
    .setDescription('ER:LC session management.')
    .addSubcommand((s) => s.setName('start').setDescription('Start and announce a roleplay session.'))
    .addSubcommand((s) => s.setName('end').setDescription('End the current roleplay session.'))
    .addSubcommand((s) => s.setName('vote').setDescription('Vote for a session.'))
    .addSubcommand((s) => s.setName('status').setDescription('View current session status.')),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    const sub = interaction.options.getSubcommand();
    if (sub === 'start' || sub === 'end') {
      await interaction.deferReply({ ephemeral: true });
      try {
        if (sub === 'start') {
          await startSession(interaction.guild, interaction.member as GuildMember);
          await interaction.editReply({ content: '✅ Session started and announced.' });
        } else {
          await endSession(interaction.guild, interaction.member as GuildMember);
          await interaction.editReply({ content: '✅ Session ended.' });
        }
      } catch (e: any) {
        await interaction.editReply({ content: `❌ ${e.message}` });
      }
      return;
    }
    if (sub === 'vote') {
      try {
        const result = await addSessionVote(interaction.guild, interaction.user.id);
        await interaction.reply({ content: `✅ Session vote recorded: **${result.count}/${result.threshold}**.`, ephemeral: true });
      } catch (e: any) {
        await replyError(interaction, e.message);
      }
      return;
    }
    const state = (await SessionModel.findOne({ guildId: interaction.guild.id })) ?? { active: false };
    const embed = await buildSessionEmbed(interaction.guild.id, state);
    await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
  },
};
