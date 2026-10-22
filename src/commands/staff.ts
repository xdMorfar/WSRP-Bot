import { randomUUID } from 'crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { BotCommand } from '../types';
import { changeStaffRank, issueStaffInfraction } from '../services/staffService';
import { getGuildConfig } from '../services/configService';
import { PendingActionModel } from '../models/PendingAction';
import { CaseModel } from '../models/Case';
import { StaffProfileModel } from '../models/StaffProfile';
import { ShiftModel } from '../models/Shift';
import { brandedEmbed } from '../utils/embeds';
import { replyError, replyOk } from '../utils/interaction';
import { canUse, hierarchyCheck } from '../utils/permissions';
import { cleanUserText } from '../utils/safe';

async function targetMember(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('member', true);
  return interaction.guild!.members.fetch(user.id).catch(() => null);
}

export const staffCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Staff management and history.')
    .addSubcommand((s) =>
      s
        .setName('promote')
        .setDescription('Promote a staff member.')
        .addUserOption((o) => o.setName('member').setDescription('Staff member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))
        .addRoleOption((o) => o.setName('rank').setDescription('Configured new rank role'))
        .addStringOption((o) => o.setName('notes').setDescription('Optional notes shown in the staff announcement').setMaxLength(1000)),
    )
    .addSubcommand((s) =>
      s
        .setName('demote')
        .setDescription('Demote a staff member.')
        .addUserOption((o) => o.setName('member').setDescription('Staff member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))
        .addRoleOption((o) => o.setName('rank').setDescription('Configured new rank role'))
        .addStringOption((o) => o.setName('notes').setDescription('Optional notes shown in the staff announcement').setMaxLength(1000)),
    )
    .addSubcommand((s) =>
      s
        .setName('infraction')
        .setDescription('Issue a staff infraction, suspension, demotion record, or termination.')
        .addUserOption((o) => o.setName('member').setDescription('Staff member').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Infraction type')
            .setRequired(true)
            .addChoices(
              { name: 'Verbal Warning', value: 'verbal-warning' },
              { name: 'Written Warning', value: 'written-warning' },
              { name: 'Strike', value: 'strike' },
              { name: 'Suspension', value: 'suspension' },
              { name: 'Demotion Record', value: 'demotion' },
              { name: 'Termination', value: 'termination' },
            ),
        )
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('notes').setDescription('Optional notes shown in the staff announcement').setMaxLength(1000))
        .addStringOption((o) => o.setName('evidence').setDescription('Evidence URLs separated by spaces').setMaxLength(1000))
        .addIntegerOption((o) => o.setName('duration_hours').setDescription('Suspension duration in hours').setMinValue(1).setMaxValue(24 * 90))
        .addBooleanOption((o) => o.setName('rehire_ineligible').setDescription('Termination only: flag as rehire-ineligible internally'))
        .addIntegerOption((o) => o.setName('rehire_days').setDescription('Optional rehire flag expiry in days').setMinValue(1).setMaxValue(3650)),
    )
    .addSubcommand((s) => s.setName('profile').setDescription('View a staff profile.').addUserOption((o) => o.setName('member').setDescription('Staff member').setRequired(true)))
    .addSubcommand((s) => s.setName('history').setDescription('View staff action history.').addUserOption((o) => o.setName('member').setDescription('Staff member').setRequired(true)))
    .addSubcommand((s) => s.setName('hierarchy').setDescription('View the configured staff rank hierarchy.'))
    .addSubcommand((s) =>
      s
        .setName('activity')
        .setDescription('View staff activity summary from recorded bot actions.')
        .addUserOption((o) => o.setName('member').setDescription('Staff member'))
        .addIntegerOption((o) => o.setName('days').setDescription('Lookback days').setMinValue(1).setMaxValue(365)),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    const actor = interaction.member as GuildMember;
    const sub = interaction.options.getSubcommand();

    if (sub === 'promote' || sub === 'demote') {
      const target = await targetMember(interaction);
      if (!target) return replyError(interaction, 'That member is not in the server.');
      await interaction.deferReply({ ephemeral: true });
      try {
        const rank = interaction.options.getRole('rank');
        const record = await changeStaffRank({
          guild: interaction.guild,
          actor,
          target,
          direction: sub,
          newRankRoleId: rank?.id,
          reason: interaction.options.getString('reason', true),
          notes: interaction.options.getString('notes') ?? undefined,
        });
        await interaction.editReply({ content: `✅ Staff ${sub} completed. Case #${record.caseId}.` });
      } catch (e: any) {
        await interaction.editReply({ content: `❌ ${e.message}` });
      }
      return;
    }

    if (sub === 'infraction') {
      const target = await targetMember(interaction);
      if (!target) return replyError(interaction, 'That member is not in the server.');
      const type = interaction.options.getString('type', true);
      const reason = interaction.options.getString('reason', true);
      const evidence = (interaction.options.getString('evidence') ?? '').split(/\s+/).filter((x) => /^https?:\/\//i.test(x)).slice(0, 10);
      if (type === 'termination') {
        const check = await hierarchyCheck(actor, target, { requiredBucket: 'management' });
        if (!check.ok) return replyError(interaction, check.reason || 'Hierarchy check failed.');
        const cfg = await getGuildConfig(interaction.guild.id);
        const staffRelated = new Set([
          ...(cfg.staffRanks ?? []).map((r: any) => r.roleId),
          ...(cfg.roles.staffAccessRoleIds ?? []),
          ...(cfg.roles.staffDivisionRoleIds ?? []),
        ]);
        const removable = target.roles.cache.filter((r) => staffRelated.has(r.id)).map((r) => r.id);
        const token = randomUUID();
        const rehireDays = interaction.options.getInteger('rehire_days');
        await PendingActionModel.create({
          token,
          guildId: interaction.guild.id,
          actorId: actor.id,
          kind: 'staff-termination',
          payload: {
            targetId: target.id,
            reason: cleanUserText(reason, 1000),
            evidence,
            notes: interaction.options.getString('notes') ?? undefined,
            rehireIneligible: interaction.options.getBoolean('rehire_ineligible') ?? false,
            rehireExpiresAt: rehireDays ? new Date(Date.now() + rehireDays * 86_400_000).toISOString() : null,
          },
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
        const embed = await brandedEmbed(interaction.guild.id, {
          title: 'Confirm Staff Termination',
          color: cfg.branding.dangerColor,
          description: `You are about to terminate <@${target.id}>. This will remove only roles explicitly configured as staff-related.`,
          fields: [
            { name: 'Reason', value: cleanUserText(reason, 900) },
            { name: 'Roles to remove', value: removable.length ? removable.map((id) => `<@&${id}>`).join(', ') : 'No configured staff-related roles currently found.' },
            { name: 'Rehire flag', value: interaction.options.getBoolean('rehire_ineligible') ? 'Rehire-ineligible (internal flag)' : 'Not set' },
          ],
        });
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`pending:confirm:${token}`).setLabel('Confirm Termination').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`pending:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      const duration = interaction.options.getInteger('duration_hours');
      if (type === 'suspension' && !duration) return replyError(interaction, 'Suspensions require duration_hours.');
      await interaction.deferReply({ ephemeral: true });
      try {
        const record = await issueStaffInfraction({
          guild: interaction.guild,
          actor,
          target,
          type,
          reason,
          evidence,
          notes: interaction.options.getString('notes') ?? undefined,
          expiry: duration ? new Date(Date.now() + duration * 3_600_000) : undefined,
        });
        await interaction.editReply({ content: `✅ Staff infraction recorded. Case #${record.caseId}.` });
      } catch (e: any) {
        await interaction.editReply({ content: `❌ ${e.message}` });
      }
      return;
    }

    if (sub === 'hierarchy') {
      const cfg = await getGuildConfig(interaction.guild.id);
      const ranks = [...(cfg.staffRanks ?? [])].sort((a: any, b: any) => b.level - a.level);
      const embed = await brandedEmbed(interaction.guild.id, {
        title: 'Staff Chain of Command',
        description: ranks.length ? ranks.map((r: any, i: number) => `${i + 1}. <@&${r.roleId}> — **${r.name}** (Level ${r.level})`).join('\n') : 'No staff ranks are configured yet.',
      });
      await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'profile' || sub === 'history') {
      const user = interaction.options.getUser('member', true);
      if (!(await canUse(actor, sub === 'history' ? 'ia' : 'moderation')) && actor.id !== user.id) return replyError(interaction, 'You are not authorized to view this staff information.');
      const profile = await StaffProfileModel.findOne({ guildId: interaction.guild.id, userId: user.id });
      const cases = await CaseModel.find({ guildId: interaction.guild.id, targetId: user.id, category: { $in: ['staff', 'staff-infraction'] } }).sort({ createdAt: -1 }).limit(sub === 'history' ? 20 : 5);
      const cfg = await getGuildConfig(interaction.guild.id);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const rank = member ? [...(cfg.staffRanks ?? [])].sort((a: any, b: any) => b.level - a.level).find((r: any) => member.roles.cache.has(r.roleId)) : null;
      const embed = await brandedEmbed(interaction.guild.id, {
        title: sub === 'profile' ? `Staff Profile — ${user.tag}` : `Staff History — ${user.tag}`,
        fields: [
          { name: 'Employment Status', value: profile?.employmentStatus ?? (rank ? 'active' : 'unknown'), inline: true },
          { name: 'Current Rank', value: rank?.name ?? 'No configured rank', inline: true },
          { name: 'Rehire Ineligible', value: profile?.rehireIneligible ? `Yes${profile.rehireExpiresAt ? ` until <t:${Math.floor(new Date(profile.rehireExpiresAt).getTime() / 1000)}:D>` : ''}` : 'No', inline: true },
          {
            name: 'Recent Staff Actions',
            value: cases.length
              ? cases.map((c: any) => `#${c.caseId} • **${c.action}** • <t:${Math.floor(new Date(c.createdAt).getTime() / 1000)}:d>${c.revoked ? ' • revoked' : ''}`).join('\n').slice(0, 1000)
              : 'No recorded staff actions.',
          },
        ],
      });
      await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'activity') {
      if (!(await canUse(actor, 'management'))) return replyError(interaction, 'Management permission is required to view staff activity summaries.');
      const user = interaction.options.getUser('member') ?? interaction.user;
      const days = interaction.options.getInteger('days') ?? 30;
      const since = new Date(Date.now() - days * 86_400_000);
      const issued = await CaseModel.countDocuments({ guildId: interaction.guild.id, issuerId: user.id, createdAt: { $gte: since } });
      const shifts = await ShiftModel.find({ guildId: interaction.guild.id, userId: user.id, clockInAt: { $gte: since }, clockOutAt: { $exists: true } });
      const seconds = shifts.reduce((sum: number, s: any) => sum + (s.durationSeconds ?? 0), 0);
      const embed = await brandedEmbed(interaction.guild.id, {
        title: `Staff Activity — ${user.tag}`,
        description: `Recorded bot activity for the last **${days} days**. Message counts are intentionally not used for promotions.`,
        fields: [
          { name: 'Recorded actions issued', value: String(issued), inline: true },
          { name: 'Completed shifts', value: String(shifts.length), inline: true },
          { name: 'Shift time', value: `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`, inline: true },
        ],
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    return replyOk(interaction, 'No action was required.');
  },
};
