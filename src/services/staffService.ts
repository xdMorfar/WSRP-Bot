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

  const previousRank = previous?.roleId ? `<@&${previous.roleId}>` : 'None';
  const nextRank = `<@&${next.roleId}>`;
  const isPromotion = input.direction === 'promote';
  const embed = await brandedEmbed(input.guild.id, {
    title: isPromotion ? 'Staff Promotion' : 'Staff Demotion',
    color: isPromotion ? cfg.branding.primaryColor : cfg.branding.warningColor,
    imageUrl: cfg.branding.staffBannerUrl || undefined,
    showDefaultThumbnail: false,
    description:
      `${isPromotion
        ? `The **${cfg.branding.name} High Rank Team** is pleased to recognize <@${input.target.id}> for their work and contribution to the staff team.`
        : `The **${cfg.branding.name} High Rank Team** has finalized a staff rank change for <@${input.target.id}>.`}

` +
      `### ${isPromotion ? 'Promotion' : 'Demotion'} Information
` +
      `**Staff Member:** <@${input.target.id}>
` +
      `**${isPromotion ? 'Promoted' : 'Demoted'} By:** <@${input.actor.id}>
` +
      `**Previous Rank:** ${previousRank}
` +
      `**New Rank:** ${nextRank}
` +
      `**Reason:** ${cleanUserText(input.reason, 900)}

` +
      `**Case:** #${record.caseId}  •  **Date:** <t:${Math.floor(Date.now() / 1000)}:F>`,
  });
  await announce(input.guild, isPromotion ? cfg.channels.promotionChannelId : cfg.channels.infractionChannelId, { embeds: [embed] });
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

  const typeLabel = input.type
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const embed = await brandedEmbed(input.guild.id, {
    title: `Staff Infraction — ${typeLabel}`,
    color: input.type === 'verbal-warning' ? cfg.branding.warningColor : cfg.branding.dangerColor,
    imageUrl: cfg.branding.staffBannerUrl || undefined,
    showDefaultThumbnail: false,
    description:
      `The **${cfg.branding.name} High Rank Team** has issued a staff disciplinary action after reviewing the relevant conduct.

` +
      `### Infraction Information
` +
      `**Staff Member:** <@${input.target.id}>
` +
      `**Issued By:** <@${input.actor.id}>
` +
      `**Infraction:** ${typeLabel}
` +
      `**Reason:** ${cleanUserText(input.reason, 900)}
` +
      `${input.expiry ? `**Expires:** <t:${Math.floor(input.expiry.getTime() / 1000)}:F>
` : ''}` +
      `
**Case:** #${record.caseId}  •  **Date:** <t:${Math.floor(Date.now() / 1000)}:F>`,
  });
  await announce(input.guild, cfg.channels.infractionChannelId, { embeds: [embed] });
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
    title: 'Staff Termination',
    color: cfg.branding.dangerColor,
    imageUrl: cfg.branding.staffBannerUrl || undefined,
    showDefaultThumbnail: false,
    description:
      `The **${cfg.branding.name} High Rank Team** has finalized a staff termination.

` +
      `### Termination Information
` +
      `**Staff Member:** <@${input.target.id}>
` +
      `**Terminated By:** <@${input.actor.id}>
` +
      `**Reason:** ${cleanUserText(input.reason, 900)}
` +
      `**Staff Roles Removed:** ${removed.length}

` +
      `**Case:** #${record.caseId}  •  **Date:** <t:${Math.floor(Date.now() / 1000)}:F>`,
  });
  await announce(input.guild, cfg.channels.infractionChannelId, { embeds: [embed] });
  await input.target.send({ embeds: [embed] }).catch(() => undefined);
  return record;
}
