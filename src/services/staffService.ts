import { EmbedBuilder, type Guild, type GuildMember } from 'discord.js';
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
  if (channel?.isTextBased()) await channel.send({ ...payload, allowedMentions: payload.allowedMentions ?? { parse: [] } }).catch(() => undefined);
}


function getShrPingRoleIds(cfg: any) {
  return [...new Set((cfg.staffRanks ?? [])
    .filter((r: any) => /(^|\b)shr(\b|$)|senior\s+high\s+rank/i.test(String(r.name || '')))
    .map((r: any) => String(r.roleId))
    .filter(Boolean))];
}

function rankDisplay(rank: { roleId?: string | null; name?: string | null } | null | undefined) {
  if (!rank) return 'Unspecified';
  return rank.roleId ? `<@&${rank.roleId}>` : String(rank.name || 'Unspecified');
}

export async function changeStaffRank(input: {
  guild: Guild;
  actor: GuildMember;
  target: GuildMember;
  direction: 'promote' | 'demote';
  newRankRoleId?: string;
  reason: string;
  notes?: string;
}) {
  const cfg = await getGuildConfig(input.guild.id);
  const check = await hierarchyCheck(input.actor, input.target, { requiredBucket: 'hr' });
  if (!check.ok) throw new Error(check.reason);

  const ranks = [...(cfg.staffRanks ?? [])].sort((a: any, b: any) => a.level - b.level);
  if (!ranks.length) throw new Error('No staff ranks are configured.');

  const previous = getRankForMember(input.target, ranks);
  const actorRank = getRankForMember(input.actor, ranks);
  if (input.actor.id !== input.guild.ownerId && !actorRank) {
    throw new Error('You need a configured staff rank before recording staff rank changes.');
  }
  if (input.direction === 'demote' && !previous) {
    throw new Error('The target does not currently have a configured staff rank to demote from.');
  }

  let next: any;
  if (input.newRankRoleId) {
    next = ranks.find((r: any) => r.roleId === input.newRankRoleId);
    if (!next) {
      const selectedRole = input.guild.roles.cache.get(input.newRankRoleId);
      next = selectedRole ? { roleId: selectedRole.id, name: selectedRole.name, level: previous?.level ?? 0 } : null;
    }
  } else if (input.direction === 'promote') next = ranks.find((r: any) => r.level > (previous?.level ?? -Infinity));
  else next = [...ranks].reverse().find((r: any) => r.level < (previous?.level ?? Infinity));

  if (!next) {
    next = { roleId: null, name: input.direction === 'promote' ? 'Promotion Recorded' : 'Demotion Recorded', level: previous?.level ?? 0 };
  }
  if (actorRank && next.level >= actorRank.level && input.actor.id !== input.guild.ownerId) {
    throw new Error('You cannot record a rank equal to or above your own configured staff rank.');
  }

  // IMPORTANT: promotions/demotions are announcement + record only.
  // SHR/management manually handles the actual Discord rank role changes.
  const notes = cleanUserText(input.notes || '', 1000);
  const record = await createCase({
    guildId: input.guild.id,
    category: 'staff',
    action: input.direction,
    targetId: input.target.id,
    issuerId: input.actor.id,
    reason: cleanUserText(input.reason, 1000),
    metadata: {
      previousRankRoleId: previous?.roleId ?? null,
      previousRankName: previous?.name ?? 'None',
      newRankRoleId: next.roleId,
      newRankName: next.name,
      notes: notes || null,
      executionStatus: 'recorded-awaiting-manual-role-change',
      roleChangeMode: 'manual-by-shr',
    },
  });

  await StaffProfileModel.findOneAndUpdate(
    { guildId: input.guild.id, userId: input.target.id },
    { $set: { employmentStatus: 'active', lastKnownRankRoleId: next.roleId } },
    { upsert: true, new: true },
  );

  const previousRank = rankDisplay(previous ? { roleId: previous.roleId, name: previous.name } : null);
  const nextRank = rankDisplay(next);
  const isPromotion = input.direction === 'promote';
  const now = Math.floor(Date.now() / 1000);

  const detailEmbed = await brandedEmbed(input.guild.id, {
    title: `${cfg.branding.name} | Staff ${isPromotion ? 'Promotion' : 'Demotion'}`,
    color: isPromotion ? cfg.branding.primaryColor : cfg.branding.warningColor,
    showDefaultThumbnail: false,
    description: isPromotion
      ? `The **${cfg.branding.name} High Rank Team** is pleased to recognize <@${input.target.id}> with a staff promotion.`
      : `The **${cfg.branding.name} High Rank Team** has recorded a staff rank adjustment for <@${input.target.id}>.`,
    fields: [
      { name: 'Staff Member', value: `<@${input.target.id}>`, inline: true },
      { name: isPromotion ? 'Promoted By' : 'Demoted By', value: `<@${input.actor.id}>`, inline: true },
      { name: 'New Rank', value: nextRank, inline: true },
      { name: 'Previous Rank', value: previousRank, inline: true },
      { name: 'Reason', value: cleanUserText(input.reason, 1024), inline: false },
      { name: 'Notes', value: notes || 'No additional notes.', inline: false },
      { name: 'Signed By', value: `<@${input.actor.id}>`, inline: false },
    ],
  });

  const embeds: any[] = [];
  if (cfg.branding.staffBannerUrl) {
    embeds.push(new EmbedBuilder().setColor(isPromotion ? cfg.branding.primaryColor : cfg.branding.warningColor).setImage(cfg.branding.staffBannerUrl));
  }
  embeds.push(detailEmbed);

  const shrRoleIds = getShrPingRoleIds(cfg);
  const mentionParts = [...shrRoleIds.map((id) => `<@&${id}>`), `<@${input.actor.id}>`];
  const allowedMentionUsers = [input.actor.id];

  await announce(
    input.guild,
    isPromotion ? cfg.channels.promotionChannelId : cfg.channels.infractionChannelId,
    {
      content: mentionParts.join(' '),
      embeds,
      allowedMentions: { parse: [], roles: shrRoleIds, users: allowedMentionUsers },
    },
  );
  await input.target.send({ embeds }).catch(() => undefined);

  return record;
}

export async function issueStaffInfraction(input: {
  guild: Guild;
  actor: GuildMember;
  target: GuildMember;
  type: string;
  reason: string;
  evidence?: string[];
  notes?: string;
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
  const notes = cleanUserText(input.notes || '', 1000);
  const publicEmbeds: any[] = [];
  if (cfg.branding.staffBannerUrl) {
    publicEmbeds.push(new EmbedBuilder().setColor(input.type === 'verbal-warning' ? cfg.branding.warningColor : cfg.branding.dangerColor).setImage(cfg.branding.staffBannerUrl));
  }
  const detailEmbed = await brandedEmbed(input.guild.id, {
    title: `Staff Infraction — ${typeLabel}`,
    color: input.type === 'verbal-warning' ? cfg.branding.warningColor : cfg.branding.dangerColor,
    showDefaultThumbnail: false,
    description: `The **${cfg.branding.name} High Rank Team** has issued a staff disciplinary action after reviewing the relevant conduct.`,
    fields: [
      { name: 'Staff Member', value: `<@${input.target.id}>`, inline: true },
      { name: 'Issued By', value: `<@${input.actor.id}>`, inline: true },
      { name: 'Infraction', value: typeLabel, inline: true },
      { name: 'Reason', value: cleanUserText(input.reason, 1024), inline: false },
      ...(notes ? [{ name: 'Notes', value: notes, inline: false as const }] : []),
      ...(input.expiry ? [{ name: 'Expires', value: `<t:${Math.floor(input.expiry.getTime() / 1000)}:F>`, inline: false as const }] : []),
      { name: 'Signed By', value: `<@${input.actor.id}>`, inline: false },
    ],
  });
  publicEmbeds.push(detailEmbed);
  const shrRoleIds = getShrPingRoleIds(cfg);
  const mentionParts = [...shrRoleIds.map((id) => `<@&${id}>`), `<@${input.actor.id}>`];
  await announce(input.guild, cfg.channels.infractionChannelId, {
    content: mentionParts.join(' '),
    embeds: publicEmbeds,
    allowedMentions: { parse: [], roles: shrRoleIds, users: [input.actor.id] },
  });
  await input.target.send({ embeds: publicEmbeds }).catch(() => undefined);

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
