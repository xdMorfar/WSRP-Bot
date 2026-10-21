import {
  ActionRowBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
} from 'discord.js';
import { canUse } from '../utils/permissions';
import { brandedEmbed } from '../utils/embeds';
import { replyError } from '../utils/interaction';
import { validateGuildConfig } from '../services/configService';
import type { BotCommand } from '../types';

export const setupCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('setup').setDescription('Open the guided Wisconsin State Roleplay bot setup.'),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    if (!(await canUse(interaction.member as GuildMember, 'setup'))) return replyError(interaction, 'Only the server owner or an explicitly authorized administrator can use setup.');

    const embed = await brandedEmbed(interaction.guild.id, {
      title: 'Wisconsin State Roleplay — Guided Setup',
      description:
        'Choose a section below. Discord channels, roles, and users are selected directly with Discord pickers; the bot stores their IDs internally so configuration stays stable after renames.\n\n' +
        '**Recommended order:** Branding → Channels → Permissions → Staff Rank → Server → Rules → Applications → Ticket Support → AutoMod → Limits & Retention.',
    });
    const menu = new StringSelectMenuBuilder()
      .setCustomId('setup:section')
      .setPlaceholder('Choose a configuration section…')
      .addOptions(
        { label: 'Branding', value: 'branding', description: 'Name, colors, logo, banner and footer.' },
        { label: 'Channels', value: 'channels', description: 'Pick actual Discord channels and categories.' },
        { label: 'Permissions & Staff Roles', value: 'roles', description: 'Pick actual Discord roles for each permission group.' },
        { label: 'Authorized Admin Users', value: 'admin-users', description: 'Pick specific Discord users allowed to run setup.' },
        { label: 'Add / Update Staff Rank', value: 'rank', description: 'Pick a Discord role, then set its rank level.' },
        { label: 'Server / Session', value: 'server', description: 'Private-server name, join code and links.' },
        { label: 'Rules', value: 'rules', description: 'Discord and in-game regulations.' },
        { label: 'Application Panel', value: 'application', description: 'Melonly link, status and panel text.' },
        { label: 'Ticket Categories', value: 'ticket', description: 'Edit ticket category text and intake questions.' },
        { label: 'Ticket Support Roles', value: 'ticket-roles', description: 'Pick Discord roles for ticket support/restricted access.' },
        { label: 'AutoMod', value: 'automod', description: 'Blocked terms/domains and thresholds.' },
        { label: 'AutoMod Exempt Roles', value: 'automod-roles', description: 'Pick roles exempt from AutoMod.' },
        { label: 'AutoMod Exempt Channels', value: 'automod-channels', description: 'Pick channels exempt from AutoMod.' },
        { label: 'Limits & Retention', value: 'limits', description: 'Ticket limits, session votes and record retention.' },
      );
    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], ephemeral: true });
  },
};

export const validateCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('validate').setDescription('Validate bot configuration and Discord permissions.'),
  async execute(interaction: ChatInputCommandInteraction, _client: Client) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    if (!(await canUse(interaction.member as GuildMember, 'setup'))) return replyError(interaction, 'You are not authorized to validate configuration.');
    await interaction.deferReply({ ephemeral: true });
    const result = await validateGuildConfig(interaction.guild);
    const embed = await brandedEmbed(interaction.guild.id, {
      title: result.issues.length ? 'Setup Validation — Action Needed' : 'Setup Validation — Ready',
      color: result.issues.length ? result.cfg.branding.warningColor : result.cfg.branding.successColor,
      description: result.issues.length ? result.issues.map((x: string, i: number) => `${i + 1}. ${x}`).join('\n') : 'No configuration or permission issues were detected by the validator.',
    });
    await interaction.editReply({ embeds: [embed] });
  },
};
