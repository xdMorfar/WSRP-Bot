import { SlashCommandBuilder, ChannelType, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import type { BotCommand } from '../types';
import { canUse } from '../utils/permissions';
import { replyError } from '../utils/interaction';
import { buildApplicationsPanel, buildDashboard, buildStaffPanel, buildTicketPanel, publishTrackedPanel } from '../services/panelService';
import { getGuildConfig } from '../services/configService';

export const dashboardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Publish or update persistent information panels.')
    .addSubcommand((s) => s.setName('publish').setDescription('Publish/update the main dashboard.').addChannelOption((o) => o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('applications').setDescription('Publish/update the Melonly application panel.').addChannelOption((o) => o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('tickets').setDescription('Publish/update the assistance / ticket panel.').addChannelOption((o) => o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('staff').setDescription('Publish/update the staff information panel.').addChannelOption((o) => o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText))),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    if (!(await canUse(interaction.member as GuildMember, 'management'))) return replyError(interaction, 'You do not have permission to publish server panels.');
    const cfg = await getGuildConfig(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const explicit = interaction.options.getChannel('channel');

    const fallbackMap: Record<string, string | undefined> = {
      publish: cfg.channels.dashboardChannelId,
      applications: cfg.channels.applicationsChannelId,
      tickets: cfg.channels.ticketPanelChannelId,
      staff: cfg.channels.staffInfoChannelId,
    };
    const channelId = explicit?.id || fallbackMap[sub];
    if (!channelId) return replyError(interaction, `No destination channel is configured for **${sub}**. Set it in /setup → Channels or provide a channel in this command.`);

    await interaction.deferReply({ ephemeral: true });
    const payload = sub === 'publish'
      ? await buildDashboard(interaction.guild.id)
      : sub === 'applications'
        ? await buildApplicationsPanel(interaction.guild.id)
        : sub === 'tickets'
          ? await buildTicketPanel(interaction.guild.id)
          : await buildStaffPanel(interaction.guild.id);
    const key = sub === 'publish' ? 'main-dashboard' : sub;
    await publishTrackedPanel({ guild: interaction.guild, key, type: sub, channelId, payload, actorId: interaction.user.id });
    const label = sub === 'publish' ? 'Dashboard' : sub === 'applications' ? 'Application panel' : sub === 'tickets' ? 'Assistance panel' : 'Staff information panel';
    await interaction.editReply({ content: `✅ ${label} published or updated successfully in <#${channelId}>.` });
  },
};
