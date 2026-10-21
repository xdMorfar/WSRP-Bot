import { SlashCommandBuilder, ChannelType, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import type { BotCommand } from '../types';
import { canUse } from '../utils/permissions';
import { replyError, replyOk } from '../utils/interaction';
import { buildApplicationsPanel, buildDashboard, buildTicketPanel, publishTrackedPanel } from '../services/panelService';
import { getGuildConfig } from '../services/configService';

export const dashboardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Publish or update persistent information panels.')
    .addSubcommand((s) => s.setName('publish').setDescription('Publish/update the main dashboard.').addChannelOption((o) => o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('applications').setDescription('Publish/update the Melonly application panel.').addChannelOption((o) => o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('tickets').setDescription('Publish/update the ticket assistance panel.').addChannelOption((o) => o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText))),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    if (!(await canUse(interaction.member as GuildMember, 'management'))) return replyError(interaction, 'You do not have permission to publish server panels.');
    const cfg = await getGuildConfig(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const explicit = interaction.options.getChannel('channel');
    const fallback = sub === 'tickets' ? cfg.channels.ticketPanelChannelId : cfg.channels.dashboardChannelId;
    const channelId = explicit?.id || fallback;
    if (!channelId) return replyError(interaction, 'No destination channel was supplied or configured.');

    await interaction.deferReply({ ephemeral: true });
    const payload = sub === 'publish' ? await buildDashboard(interaction.guild.id) : sub === 'applications' ? await buildApplicationsPanel(interaction.guild.id) : await buildTicketPanel(interaction.guild.id);
    const key = sub === 'publish' ? 'main-dashboard' : sub === 'applications' ? 'applications' : 'tickets';
    await publishTrackedPanel({ guild: interaction.guild, key, type: sub, channelId, payload, actorId: interaction.user.id });
    await interaction.editReply({ content: `✅ ${sub === 'publish' ? 'Dashboard' : sub === 'applications' ? 'Application panel' : 'Ticket panel'} published or updated successfully.` });
  },
};
