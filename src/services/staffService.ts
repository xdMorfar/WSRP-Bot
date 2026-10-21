import type { Guild, GuildMember } from 'discord.js';
import { getGuildConfig } from './configService';
import { createCase } from './caseService';
import { StaffProfileModel } from '../models/StaffProfile';
import { TimedActionModel } from '../models/TimedAction';
import { brandedEmbed } from '../utils/embeds';
import { cleanUserText } from '../utils/safe';
import { hierarchyCheck } from '../utils/permissions';

function getRankForMember(member: GuildMember, ranks: any[]) {
  return [...ranks].sort((a, b) => b.level - a.level).find((r) => member.roles.cache.has(r.roleId)) ?? null;
}

async function announce(guild: Guild, channelId: string | undefined, payload: any) {
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (channel?.isTextBased()) await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch(() => undefined);
}

export async function changeStaffRank(input: {
  guild: Guild;
  actor: GuildMember;
  target: GuildMember;
  direction: 'promote' | 'demote';
  newRankRoleId?: string;
  reason: string;
}) {
  const cfg = await getGuildConfig(input.guild.id);
  const check = await hierarchyCheck(input.actor, input.target, { requiredBucket: 'hr' });
  if (!check.ok) throw new Error(check.reason);
  const ranks = [...(cfg.staffRanks ?? [])].sort((a: any, b: any) => a.level - b.level);
  if (!ranks.length) throw new Error('No staff ranks are configured.');
  const previous = getRankForMember(input.target, ranks);
  const actorRank = getRankForMember(input.actor, ranks);
  if (input.actor.id !== input.guild.ownerId && !actorRank) throw new Error('You need a configured staff rank before changing staff ranks.');
  if (input.direction === 'demote' && !previous) throw new Error('The target does not currently have a configured staff rank to demote from.');
  let next: any;
  if (input.newRankRoleId) next = ranks.find((r: any) => r.roleId === input.newRankRoleId);
  else if (input.direction === 'promote') next = ranks.find((r: any) => r.level > (previous?.level ?? -Infinity));
  else next = [...ranks].reverse().find((r: any) => r.level < (previous?.level ?? Infinity));
  if (!next) throw new Error(`No valid rank found for that ${input.direction}.`);
  if (actorRank && next.level >= actorRank.level && input.actor.id !== input.guild.ownerId) {
    throw new Error('You cannot grant a rank equal to or above your own configured staff rank.');
  }
  const bot = input.guild.members.me;
  const nextRole = input.guild.roles.cache.get(next.roleId);
  if (!nextRole) throw new Error('The configured target rank role no longer exists.');
  if (!bot || nextRole.position >= bot.roles.highest.position) throw new Error('The bot role must be above the rank role it needs to assign.');

  const rankRoleIds = ranks.map((r: any) => r.roleId);
  const removable = input.target.roles.cache.filter((role) => rankRoleIds.includes(role.id) && role.id !== next.roleId).map((r) => r.id);
  const blockedRemovals = removable.filter((id) => {
    const role = input.guild.roles.cache.get(id);
    return role && bot && role.position >= bot.roles.highest.position;
  });
  if (blockedRemovals.length) throw new Error(`The bot role is below a rank role it must remove: ${blockedRemovals.map((id) => `<@&${id}>`).join(', ')}.`);

  const record = await createCase({
    guildId: input.guild.id,
    category: 'staff',
    action: input.direction,
    targetId: input.target.id,
    issuerId: input.actor.id,
    reason: cleanUserText(input.reason, 1000),
    metadata: { previousRankRoleId: previous?.roleId ?? null, previousRankName: previous?.name ?? 'None', newRankRoleId: next.roleId, newRankName: next.name, executionStatus: 'pending' },
  });

  const originallyHadNext = input.target.roles.cache.has(next.roleId);
  try {
    if (removable.length) await input.target.roles.remove(removable, `${input.direction} case #${record.caseId} by ${input.actor.user.tag}`);
    if (!originallyHadNext) await input.target.roles.add(next.roleId, `${input.direction} case #${record.caseId} by ${input.actor.user.tag}`);
    record.metadata = { ...(record.metadata ?? {}), executionStatus: 'completed' };
    await record.save();
  } catch (error: any) {
    let rollbackFailed = false;
    try {
      if (removable.length) await input.target.roles.add(removable, `Rollback failed ${input.direction} case #${record.caseId}`);
      if (!originallyHadNext && input.target.roles.cache.has(next.roleId)) await input.target.roles.remove(next.roleId, `Rollback failed ${input.direction} case #${record.caseId}`);
    } catch {
      rollbackFailed = true;
    }
    record.revoked = true;
    record.revokedBy = input.guild.members.me?.id;
    record.revokedAt = new Date();
    record.revokedReason = `Rank change execution failed${rollbackFailed ? '; rollback was incomplete' : '; role changes were rolled back'}.`;
    record.metadata = { ...(record.metadata ?? {}), executionStatus: rollbackFailed ? 'failed-partial' : 'failed-rolled-back', error: String(error?.message || error) };
    await record.save().catch(() => undefined);
    throw new Error(`Rank change failed${rollbackFailed ? ' and automatic rollback was incomplete. Review the member roles and case immediately.' : '; previous roles were restored.'}`);
  }
  await StaffProfileModel.findOneAndUpdate(
    { guildId: input.guild.id, userId: input.target.id },
    { $set: { employmentStatus: 'active', lastKnownRankRoleId: next.roleId } },
    { upsert: true, new: true },
  );

  const embed = await brandedEmbed(input.guild.id, {
    title: `${cfg.branding.name} | Staff ${input.direction === 'promote' ? 'Promotion' : 'Demotion'}`,
    color: input.direction === 'promote' ? cfg.branding.successColor : cfg.branding.warningColor,
    imageUrl: cfg.branding.staffBannerUrl || undefined,
    description:
      input.direction === 'promote'
        ? `The ${cfg.branding.name} High Rank Team is pleased to recognize this staff member with a promotion.`
        : `The ${cfg.branding.name} High Rank Team has issued a staff rank change.`,
    fields: [
      { name: 'Staff Member', value: `<@${input.target.id}>`, inline: true },
      { name: 'Previous Rank', value: previous?.name ?? 'None', inline: true },
      { name: 'New Rank', value: next.name, inline: true },
      { name: 'Reason', value: cleanUserText(input.reason, 900) },
      { name: 'Case', value: `#${record.caseId}`, inline: true },
      { name: 'Signed by', value: `<@${input.actor.id}>`, inline: true },
    ],
  });
  await announce(input.guild, cfg.channels.staffActionChannelId, { embeds: [embed] });
  await input.target.send({ embeds: [embed] }).catch(() => undefined);
  return record;
}

export async function issueStaffInfraction(input: {
  guild: Guild;
  actor: GuildMember;
  target: GuildMember;
  type: string;
  reason: string;
  evidence?: string[];
  expiry?: Date;
}) {
  const cfg = await getGuildConfig(input.guild.id);
  const check = await hierarchyCheck(input.actor, input.target, { requiredBucket: input.type === 'termination' ? 'management' : 'ia' });
  if (!check.ok) throw new Error(check.reason);
  if (input.type === 'termination') throw new Error('Termination must be confirmed through the dedicated confirmation flow.');

  let affectedRoles: string[] = [];
  if (input.type === 'suspension') {
    const staffRelated = new Set([
      ...(cfg.staffRanks ?? []).map((r: any) => r.roleId),
      ...(cfg.roles.staffAccessRoleIds ?? []),
      ...(cfg.roles.staffDivisionRoleIds ?? []),
    ]);
    affectedRoles = input.target.roles.cache.filter((r) => staffRelated.has(r.id)).map((r) => r.id);
    const bot = input.guild.members.me;
    const blocked = affectedRoles.filter((id) => { const role = input.guild.roles.cache.get(id); return role && bot && role.position >= bot.roles.highest.position; });
    if (blocked.length) throw new Error(`Bot role hierarchy blocks suspension role changes for: ${blocked.map((id) => `<@&${id}>`).join(', ')}. Move the bot role higher before retrying.`);
  }

  const record = await createCase({
    guildId: input.guild.id,
    category: 'staff-infraction',
    action: input.type,
    targetId: input.target.id,
    issuerId: input.actor.id,
    reason: cleanUserText(input.reason, 1000),
    evidence: input.evidence ?? [],
    metadata: { expiresAt: input.expiry?.toISOString() ?? null, affectedRoles },
  });

  if (input.type === 'suspension') {
    try {
      if (affectedRoles.length) await input.target.roles.remove(affectedRoles, `Staff suspension case #${record.caseId}`);
      await StaffProfileModel.findOneAndUpdate({ guildId: input.guild.id, userId: input.target.id }, { $set: { employmentStatus: 'suspended' } }, { upsert: true });
      if (input.expiry) {
        await TimedActionModel.create({ guildId: input.guild.id, userId: input.target.id, type: 'suspension', executeAt: input.expiry, payload: { caseId: record.caseId, roles: affectedRoles } });
      }
      record.metadata = { ...(record.metadata ?? {}), affectedRoles, executionStatus: 'completed' };
      await record.save();
    } catch (error: any) {
      let rollbackFailed = false;
      try {
        if (affectedRoles.length) await input.target.roles.add(affectedRoles, `Rollback failed suspension case #${record.caseId}`);
        await StaffProfileModel.findOneAndUpdate({ guildId: input.guild.id, userId: input.target.id }, { $set: { employmentStatus: 'active' } }, { upsert: true });
        await TimedActionModel.updateMany({ guildId: input.guild.id, type: 'suspension', 'payload.caseId': record.caseId, status: 'pending' }, { $set: { status: 'cancelled' } });
      } catch {
        rollbackFailed = true;
      }
      record.revoked = true;
      record.revokedBy = input.guild.members.me?.id;
      record.revokedAt = new Date();
      record.revokedReason = `Suspension execution failed${rollbackFailed ? '; rollback was incomplete' : '; role changes were rolled back'}.`;
      record.metadata = { ...(record.metadata ?? {}), executionStatus: rollbackFailed ? 'failed-partial' : 'failed-rolled-back', error: String(error?.message || error) };
      await record.save().catch(() => undefined);
      throw new Error(`Suspension failed${rollbackFailed ? ' and rollback was incomplete. Review member roles immediately.' : '; previous roles were restored.'}`);
    }
  }

  const embed = await brandedEmbed(input.guild.id, {
    title: `${cfg.branding.name} | Staff Infraction — ${input.type.replace(/\b\w/g, (m: string) => m.toUpperCase())}`,
    color: input.type === 'verbal-warning' ? cfg.branding.warningColor : cfg.branding.dangerColor,
    imageUrl: cfg.branding.staffBannerUrl || undefined,
    description: `The ${cfg.branding.name} High Rank Team has issued this action after reviewing the relevant staff conduct and regulations.`,
    fields: [
      { name: 'Staff Member', value: `<@${input.target.id}>`, inline: true },
      { name: 'Infraction', value: input.type.replace(/-/g, ' '), inline: true },
      { name: 'Case', value: `#${record.caseId}`, inline: true },
      { name: 'Reason', value: cleanUserText(input.reason, 900) },
      ...(input.expiry ? [{ name: 'Expires', value: `<t:${Math.floor(input.expiry.getTime() / 1000)}:F>` }] : []),
      { name: 'Signed by', value: `<@${input.actor.id}>` },
    ],
  });
  await announce(input.guild, cfg.channels.staffActionChannelId, { embeds: [embed] });
  await input.target.send({ embeds: [embed] }).catch(() => undefined);
  return record;
}

export async function terminateStaff(input: {
  guild: Guild;
  actor: GuildMember;
  target: GuildMember;
  reason: string;
  evidence?: string[];
  rehireIneligible?: boolean;
  rehireReason?: string;
  rehireExpiresAt?: Date;
}) {
  const cfg = await getGuildConfig(input.guild.id);
  const check = await hierarchyCheck(input.actor, input.target, { requiredBucket: 'management' });
  if (!check.ok) throw new Error(check.reason);
  const staffRelated = new Set([
    ...(cfg.staffRanks ?? []).map((r: any) => r.roleId),
    ...(cfg.roles.staffAccessRoleIds ?? []),
    ...(cfg.roles.staffDivisionRoleIds ?? []),
  ]);
  const removed = input.target.roles.cache.filter((r) => staffRelated.has(r.id)).map((r) => r.id);
  const bot = input.guild.members.me;
  const blocked = removed.filter((id) => { const role = input.guild.roles.cache.get(id); return role && bot && role.position >= bot.roles.highest.position; });
  if (blocked.length) throw new Error(`Bot role hierarchy blocks termination role removal for: ${blocked.map((id) => `<@&${id}>`).join(', ')}. Move the bot role higher before retrying.`);

  // Create the audit record before any destructive role change. If execution fails,
  // the case is preserved as a revoked/failed attempt instead of silently disappearing.
  const record = await createCase({
    guildId: input.guild.id,
    category: 'staff-infraction',
    action: 'termination',
    targetId: input.target.id,
    issuerId: input.actor.id,
    reason: cleanUserText(input.reason, 1000),
    evidence: input.evidence ?? [],
    metadata: {
      removedRoles: removed,
      rehireIneligible: !!input.rehireIneligible,
      rehireExpiresAt: input.rehireExpiresAt?.toISOString() ?? null,
      executionStatus: 'pending',
    },
  });

  try {
    if (removed.length) await input.target.roles.remove(removed, `Staff termination case #${record.caseId} by ${input.actor.user.tag}`);

    await StaffProfileModel.findOneAndUpdate(
      { guildId: input.guild.id, userId: input.target.id },
      {
        $set: {
          employmentStatus: 'terminated',
          lastKnownRankRoleId: null,
          rehireIneligible: !!input.rehireIneligible,
          rehireReason: input.rehireReason ? cleanUserText(input.rehireReason, 500) : undefined,
          rehireExpiresAt: input.rehireExpiresAt,
        },
      },
      { upsert: true },
    );

    await TimedActionModel.updateMany(
      { guildId: input.guild.id, userId: input.target.id, type: 'suspension', status: 'pending' },
      { $set: { status: 'cancelled' } },
    );

    record.metadata = { ...(record.metadata ?? {}), executionStatus: 'completed' };
    await record.save();
  } catch (error: any) {
    let rollbackFailed = false;
    try {
      const restorable = removed.filter((id) => input.guild.roles.cache.has(id));
      if (restorable.length) await input.target.roles.add(restorable, `Rollback failed termination case #${record.caseId}`);
      const currentRank = getRankForMember(input.target, cfg.staffRanks ?? []);
      await StaffProfileModel.findOneAndUpdate(
        { guildId: input.guild.id, userId: input.target.id },
        {
          $set: {
            employmentStatus: 'active',
            lastKnownRankRoleId: currentRank?.roleId ?? null,
            rehireIneligible: false,
          },
          $unset: { rehireReason: 1, rehireExpiresAt: 1 },
        },
        { upsert: true },
      );
    } catch {
      rollbackFailed = true;
    }

    record.revoked = true;
    record.revokedBy = input.guild.members.me?.id;
    record.revokedAt = new Date();
    record.revokedReason = `Termination execution failed${rollbackFailed ? '; rollback was incomplete' : '; staff roles were restored'}.`;
    record.metadata = {
      ...(record.metadata ?? {}),
      executionStatus: rollbackFailed ? 'failed-partial' : 'failed-rolled-back',
      error: String(error?.message || error),
    };
    await record.save().catch(() => undefined);
    throw new Error(`Termination failed${rollbackFailed ? ' and automatic rollback was incomplete. Review the member roles and case immediately.' : '; previous staff roles were restored.'}`);
  }

  const embed = await brandedEmbed(input.guild.id, {
    title: `${cfg.branding.name} | Staff Termination`,
    color: cfg.branding.dangerColor,
    imageUrl: cfg.branding.staffBannerUrl || undefined,
    description: `A staff employment action has been finalized by the ${cfg.branding.name} High Rank Team.`,
    fields: [
      { name: 'Staff Member', value: `<@${input.target.id}>`, inline: true },
      { name: 'Action', value: 'Termination', inline: true },
      { name: 'Case', value: `#${record.caseId}`, inline: true },
      { name: 'Reason', value: cleanUserText(input.reason, 900) },
      { name: 'Staff roles removed', value: removed.length ? removed.map((id) => `<@&${id}>`).join(', ') : 'None found' },
      { name: 'Signed by', value: `<@${input.actor.id}>` },
    ],
  });
  await announce(input.guild, cfg.channels.staffActionChannelId, { embeds: [embed] });
  await input.target.send({ embeds: [embed] }).catch(() => undefined);
  return record;
}
