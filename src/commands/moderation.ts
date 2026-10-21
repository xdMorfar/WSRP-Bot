import { randomUUID } from 'crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import ms from 'ms';
import type { BotCommand } from '../types';
import { banUser, kickMember, timeoutMember, warnMember } from '../services/moderationService';
import { canUse, hierarchyCheck } from '../utils/permissions';
import { replyError, replyOk } from '../utils/interaction';
import { PendingActionModel } from '../models/PendingAction';
import { CaseModel } from '../models/Case';
import { createCase } from '../services/caseService';
import { brandedEmbed } from '../utils/embeds';
import { cleanUserText } from '../utils/safe';
import { startLockdown, endLockdown } from '../services/lockdownService';
import { TimedActionModel } from '../models/TimedAction';
import { StaffProfileModel } from '../models/StaffProfile';
import { getGuildConfig } from '../services/configService';

async function actor(interaction: ChatInputCommandInteraction) {
  return interaction.member as GuildMember;
}

async function requireMod(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.member) {
    await replyError(interaction, 'This command can only be used in a server.');
    return false;
  }
  if (!(await canUse(interaction.member as GuildMember, 'moderation'))) {
    await replyError(interaction, 'You do not have configured moderation permission.');
    return false;
  }
  return true;
}

export const warnCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a Discord member.')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))
    .addStringOption((o) => o.setName('evidence').setDescription('Evidence URLs separated by spaces').setMaxLength(1000)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    const user = interaction.options.getUser('member', true);
    const target = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!target) return replyError(interaction, 'That member is not in the server.');
    await interaction.deferReply({ ephemeral: true });
    try {
      const evidence = (interaction.options.getString('evidence') ?? '').split(/\s+/).filter((x) => /^https?:\/\//.test(x)).slice(0, 10);
      const record = await warnMember(interaction.guild!, await actor(interaction), target, interaction.options.getString('reason', true), evidence);
      await interaction.editReply({ content: `✅ Discord warning issued. Case #${record.caseId}.` });
    } catch (e: any) {
      await interaction.editReply({ content: `❌ ${e.message}` });
    }
  },
};

export const warningsCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('warnings').setDescription('View Discord warnings for a member.').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    const user = interaction.options.getUser('member', true);
    const records = await CaseModel.find({ guildId: interaction.guild!.id, targetId: user.id, category: 'discord-moderation', action: 'warn' }).sort({ createdAt: -1 }).limit(25);
    const embed = await brandedEmbed(interaction.guild!.id, {
      title: `Warnings — ${user.tag}`,
      description: records.length ? records.map((r: any) => `#${r.caseId} • ${r.revoked ? '**REVOKED** • ' : ''}${r.reason.slice(0, 150)} • <t:${Math.floor(new Date(r.createdAt).getTime() / 1000)}:d>`).join('\n') : 'No warnings found.',
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export const kickCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('kick').setDescription('Kick a Discord member.').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    const user = interaction.options.getUser('member', true);
    const target = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!target) return replyError(interaction, 'That member is not in the server.');
    await interaction.deferReply({ ephemeral: true });
    try {
      const record = await kickMember(interaction.guild!, await actor(interaction), target, interaction.options.getString('reason', true));
      await interaction.editReply({ content: `✅ Member kicked. Discord moderation case #${record.caseId}.` });
    } catch (e: any) {
      await interaction.editReply({ content: `❌ ${e.message}` });
    }
  },
};

export const banCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a Discord user after confirmation.')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))
    .addIntegerOption((o) => o.setName('delete_seconds').setDescription('Delete recent messages, seconds').setMinValue(0).setMaxValue(604800)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    const target = interaction.options.getUser('user', true);
    const member = await interaction.guild!.members.fetch(target.id).catch(() => null);
    if (member) {
      const check = await hierarchyCheck(await actor(interaction), member, { requiredBucket: 'moderation' });
      if (!check.ok) return replyError(interaction, check.reason || 'Hierarchy check failed.');
    }
    const token = randomUUID();
    await PendingActionModel.create({
      token,
      guildId: interaction.guild!.id,
      actorId: interaction.user.id,
      kind: 'discord-ban',
      payload: { targetId: target.id, reason: cleanUserText(interaction.options.getString('reason', true), 1000), deleteMessageSeconds: interaction.options.getInteger('delete_seconds') ?? 0 },
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const embed = await brandedEmbed(interaction.guild!.id, { title: 'Confirm Discord Ban', description: `Target: <@${target.id}>\nReason: ${cleanUserText(interaction.options.getString('reason', true), 900)}\n\nThis is a **Discord ban**, not an ER:LC in-game ban.` });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`pending:confirm:${token}`).setLabel('Confirm Ban').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`pending:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true, allowedMentions: { parse: [] } });
  },
};

export const unbanCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('unban').setDescription('Unban a Discord user by ID.').addStringOption((o) => o.setName('user_id').setDescription('Discord user ID').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    const id = interaction.options.getString('user_id', true);
    if (!/^\d{15,22}$/.test(id)) return replyError(interaction, 'Invalid Discord user ID.');
    try {
      const rec = await createCase({ guildId: interaction.guild!.id, category: 'discord-moderation', action: 'unban', targetId: id, issuerId: interaction.user.id, reason: cleanUserText(interaction.options.getString('reason', true), 1000), metadata: { executionStatus: 'pending' } });
      try {
        await interaction.guild!.members.unban(id, cleanUserText(interaction.options.getString('reason', true), 400));
        rec.metadata = { ...(rec.metadata ?? {}), executionStatus: 'completed' };
        await rec.save();
      } catch (error: any) {
        rec.revoked = true; rec.revokedBy = interaction.user.id; rec.revokedAt = new Date(); rec.revokedReason = 'Unban execution failed.';
        rec.metadata = { ...(rec.metadata ?? {}), executionStatus: 'failed', error: String(error?.message || error) };
        await rec.save().catch(() => undefined);
        throw error;
      }
      await replyOk(interaction, `User unbanned. Case #${rec.caseId}.`);
    } catch (e: any) {
      await replyError(interaction, e.message || 'Failed to unban user.');
    }
  },
};

export const timeoutCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('timeout').setDescription('Timeout a Discord member.').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption((o) => o.setName('duration').setDescription('Examples: 10m, 2h, 3d').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    const user = interaction.options.getUser('member', true);
    const target = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!target) return replyError(interaction, 'That member is not in the server.');
    const duration = ms(interaction.options.getString('duration', true) as any);
    if (!duration || duration < 1000 || duration > 28 * 86_400_000) return replyError(interaction, 'Duration must be between 1 second and 28 days, e.g. `10m`, `2h`, `3d`.');
    await interaction.deferReply({ ephemeral: true });
    try {
      const rec = await timeoutMember(interaction.guild!, await actor(interaction), target, duration, interaction.options.getString('reason', true));
      await interaction.editReply({ content: `✅ Member timed out. Case #${rec.caseId}.` });
    } catch (e: any) {
      await interaction.editReply({ content: `❌ ${e.message}` });
    }
  },
};

export const untimeoutCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('untimeout').setDescription('Remove a Discord timeout.').addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    const user = interaction.options.getUser('member', true);
    const target = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!target) return replyError(interaction, 'That member is not in the server.');
    const check = await hierarchyCheck(await actor(interaction), target, { requiredBucket: 'moderation' });
    if (!check.ok) return replyError(interaction, check.reason || 'Hierarchy check failed.');
    const rec = await createCase({ guildId: interaction.guild!.id, category: 'discord-moderation', action: 'untimeout', targetId: target.id, issuerId: interaction.user.id, reason: cleanUserText(interaction.options.getString('reason', true), 1000), metadata: { executionStatus: 'pending' } });
    try {
      await target.timeout(null, cleanUserText(interaction.options.getString('reason', true), 400));
      rec.metadata = { ...(rec.metadata ?? {}), executionStatus: 'completed' };
      await rec.save();
    } catch (error: any) {
      rec.revoked = true; rec.revokedBy = interaction.user.id; rec.revokedAt = new Date(); rec.revokedReason = 'Untimeout execution failed.';
      rec.metadata = { ...(rec.metadata ?? {}), executionStatus: 'failed', error: String(error?.message || error) };
      await rec.save().catch(() => undefined);
      throw error;
    }
    await replyOk(interaction, `Timeout removed. Case #${rec.caseId}.`);
  },
};

export const purgeCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('purge').setDescription('Bulk-delete recent messages.').addIntegerOption((o) => o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)).addUserOption((o) => o.setName('user').setDescription('Only messages from this user')).addStringOption((o) => o.setName('reason').setDescription('Audit reason').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    if (!interaction.channel || !('bulkDelete' in interaction.channel)) return replyError(interaction, 'This channel does not support bulk deletion.');
    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');
    if (amount > 20) {
      const token = randomUUID();
      await PendingActionModel.create({ token, guildId: interaction.guild!.id, actorId: interaction.user.id, kind: 'purge', payload: { channelId: interaction.channel.id, amount, userId: user?.id ?? null, reason: cleanUserText(interaction.options.getString('reason', true), 500) }, expiresAt: new Date(Date.now() + 10 * 60_000) });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`pending:confirm:${token}`).setLabel(`Confirm purge ${amount}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`pending:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ content: `Confirm deletion of up to **${amount}** recent messages${user ? ` from ${user.tag}` : ''}.`, components: [row], ephemeral: true });
      return;
    }
    const messages = await interaction.channel.messages.fetch({ limit: Math.min(100, amount + 20) });
    const filtered = user ? messages.filter((m: any) => m.author.id === user.id).first(amount) : messages.first(amount);
    const deleted = await (interaction.channel as TextChannel).bulkDelete(filtered as any, true);
    const rec = await createCase({ guildId: interaction.guild!.id, category: 'discord-moderation', action: 'purge', targetId: interaction.channel.id, issuerId: interaction.user.id, reason: cleanUserText(interaction.options.getString('reason', true), 500), metadata: { requested: amount, deleted: deleted.size, filteredUserId: user?.id ?? null } });
    await replyOk(interaction, `Deleted ${deleted.size} messages. Case #${rec.caseId}.`);
  },
};

export const slowmodeCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode in the current text channel.').addIntegerOption((o) => o.setName('seconds').setDescription('0 disables').setRequired(true).setMinValue(0).setMaxValue(21600)).addStringOption((o) => o.setName('reason').setDescription('Audit reason').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    if (!interaction.channel || !('setRateLimitPerUser' in interaction.channel)) return replyError(interaction, 'This channel does not support slowmode.');
    const seconds = interaction.options.getInteger('seconds', true);
    const reason = cleanUserText(interaction.options.getString('reason', true), 500);
    await (interaction.channel as TextChannel).setRateLimitPerUser(seconds, `${reason} — changed by ${interaction.user.tag}`.slice(0, 500));
    const rec = await createCase({ guildId: interaction.guild!.id, category: 'discord-moderation', action: 'slowmode', targetId: interaction.channel.id, issuerId: interaction.user.id, reason, metadata: { seconds } });
    await replyOk(interaction, `Slowmode set to ${seconds} seconds. Case #${rec.caseId}.`);
  },
};

export const lockCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('lock').setDescription('Lock the current text channel for @everyone.').addStringOption((o) => o.setName('reason').setDescription('Audit reason').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    if (!interaction.channel || !('permissionOverwrites' in interaction.channel)) return replyError(interaction, 'This channel cannot be locked.');
    const reason = cleanUserText(interaction.options.getString('reason', true), 500);
    await interaction.channel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: false }, { reason: `${reason} — locked by ${interaction.user.tag}`.slice(0, 500) });
    const rec = await createCase({ guildId: interaction.guild!.id, category: 'discord-moderation', action: 'lock', targetId: interaction.channel.id, issuerId: interaction.user.id, reason });
    await replyOk(interaction, `Channel locked. Case #${rec.caseId}.`);
  },
};

export const unlockCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('unlock').setDescription('Unlock the current text channel for @everyone.').addStringOption((o) => o.setName('reason').setDescription('Audit reason').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    if (!interaction.channel || !('permissionOverwrites' in interaction.channel)) return replyError(interaction, 'This channel cannot be unlocked.');
    const reason = cleanUserText(interaction.options.getString('reason', true), 500);
    await interaction.channel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: null }, { reason: `${reason} — unlocked by ${interaction.user.tag}`.slice(0, 500) });
    const rec = await createCase({ guildId: interaction.guild!.id, category: 'discord-moderation', action: 'unlock', targetId: interaction.channel.id, issuerId: interaction.user.id, reason });
    await replyOk(interaction, `Channel unlocked. Case #${rec.caseId}.`);
  },
};

export const caseCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('View or amend moderation/staff cases.')
    .addSubcommand((s) => s.setName('view').setDescription('View a case.').addIntegerOption((o) => o.setName('id').setDescription('Case ID').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('amend').setDescription('Add an audit amendment or revoke a case.').addIntegerOption((o) => o.setName('id').setDescription('Case ID').setRequired(true).setMinValue(1)).addStringOption((o) => o.setName('note').setDescription('Amendment note').setRequired(true).setMaxLength(1000)).addBooleanOption((o) => o.setName('revoke').setDescription('Mark this case revoked'))),
  async execute(interaction) {
    if (!(await requireMod(interaction))) return;
    const id = interaction.options.getInteger('id', true);
    const record = await CaseModel.findOne({ guildId: interaction.guild!.id, caseId: id });
    if (!record) return replyError(interaction, 'Case not found.');
    const actingMember = await actor(interaction);
    if (record.category === 'staff-infraction' && !(await canUse(actingMember, 'ia'))) {
      return replyError(interaction, 'Internal Affairs or management permission is required to view or amend staff disciplinary cases.');
    }
    if (record.category === 'staff' && !(await canUse(actingMember, 'hr'))) {
      return replyError(interaction, 'HR or management permission is required to view or amend staff rank cases.');
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
      const embed = await brandedEmbed(interaction.guild!.id, {
        title: `Case #${record.caseId} — ${record.action}`,
        fields: [
          { name: 'Category', value: record.category, inline: true },
          { name: 'Target', value: `<@${record.targetId}>`, inline: true },
          { name: 'Issuer', value: `<@${record.issuerId}>`, inline: true },
          { name: 'Reason', value: record.reason },
          { name: 'Status', value: record.revoked ? `Revoked: ${record.revokedReason || 'No reason recorded'}` : 'Active' },
          { name: 'Evidence', value: record.evidence?.length ? record.evidence.join('\n').slice(0, 1000) : 'None recorded' },
          { name: 'Amendments', value: record.amendments?.length ? record.amendments.map((a: any) => `<@${a.authorId}>: ${a.note}`).join('\n').slice(0, 1000) : 'None' },
        ],
      });
      await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    const note = cleanUserText(interaction.options.getString('note', true), 1000);
    record.amendments.push({ authorId: interaction.user.id, at: new Date(), note } as any);
    if (interaction.options.getBoolean('revoke')) {
      if (record.action === 'suspension') {
        const target = await interaction.guild!.members.fetch(record.targetId).catch(() => null);
        const capturedRoles: string[] = record.metadata?.affectedRoles ?? [];
        let restorableRoles = capturedRoles.filter((roleId: string) => interaction.guild!.roles.cache.has(roleId));

        if (target && restorableRoles.length) {
          const cfg = await getGuildConfig(interaction.guild!.id);
          const rankRoleIds = new Set((cfg.staffRanks ?? []).map((r: any) => r.roleId));
          const hasCurrentConfiguredRank = (cfg.staffRanks ?? []).some((r: any) => target.roles.cache.has(r.roleId));
          if (hasCurrentConfiguredRank) restorableRoles = restorableRoles.filter((roleId: string) => !rankRoleIds.has(roleId));

          const bot = interaction.guild!.members.me;
          const blocked = restorableRoles.filter((roleId: string) => {
            const role = interaction.guild!.roles.cache.get(roleId);
            return role && bot && role.position >= bot.roles.highest.position;
          });
          if (blocked.length) {
            return replyError(interaction, `The bot cannot safely restore the captured suspension roles because its role is below: ${blocked.map((roleId: string) => `<@&${roleId}>`).join(', ')}.`);
          }
        }

        await TimedActionModel.updateMany({ guildId: interaction.guild!.id, type: 'suspension', status: 'pending', 'payload.caseId': record.caseId }, { $set: { status: 'cancelled' } });
        if (target && restorableRoles.length) await target.roles.add(restorableRoles, `Suspension case #${record.caseId} revoked`);
        await StaffProfileModel.findOneAndUpdate({ guildId: interaction.guild!.id, userId: record.targetId }, { $set: { employmentStatus: 'active' } }, { upsert: true });
      }

      record.revoked = true;
      record.revokedBy = interaction.user.id;
      record.revokedAt = new Date();
      record.revokedReason = note;
    }
    await record.save();
    await replyOk(interaction, `Case #${id} amended${record.revoked ? ' and marked revoked' : ''}. The original record was preserved.`);
  },
};

export const lockdownCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('lockdown').setDescription('Emergency server-wide message lockdown with restoration.').addSubcommand((s) => s.setName('start').setDescription('Save current channel state and lock @everyone sending.')).addSubcommand((s) => s.setName('end').setDescription('Restore saved channel permission state.')),
  async execute(interaction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    await interaction.deferReply({ ephemeral: true });
    try {
      if (interaction.options.getSubcommand() === 'start') {
        const count = await startLockdown(interaction.guild, interaction.member as GuildMember);
        await interaction.editReply({ content: `✅ Emergency lockdown enabled across ${count} text/announcement channels. Previous states were saved.` });
      } else {
        const count = await endLockdown(interaction.guild, interaction.member as GuildMember);
        await interaction.editReply({ content: `✅ Emergency lockdown ended. Restored ${count} channel states.` });
      }
    } catch (e: any) {
      await interaction.editReply({ content: `❌ ${e.message}` });
    }
  },
};

export const moderationCommands: BotCommand[] = [
  warnCommand,
  warningsCommand,
  kickCommand,
  banCommand,
  unbanCommand,
  timeoutCommand,
  untimeoutCommand,
  purgeCommand,
  slowmodeCommand,
  lockCommand,
  unlockCommand,
  caseCommand,
  lockdownCommand,
];
