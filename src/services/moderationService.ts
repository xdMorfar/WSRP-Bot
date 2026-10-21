import type { Guild, GuildMember, User } from 'discord.js';
import { createCase } from './caseService';
import { getGuildConfig } from './configService';
import { brandedEmbed } from '../utils/embeds';
import { cleanUserText } from '../utils/safe';
import { canUse, hierarchyCheck } from '../utils/permissions';

async function logCase(guild: Guild, title: string, record: any, color?: number) {
  const cfg = await getGuildConfig(guild.id);
  const channel = cfg.channels.moderationLogChannelId ? guild.channels.cache.get(cfg.channels.moderationLogChannelId) : null;
  if (!channel?.isTextBased()) return;
  const embed = await brandedEmbed(guild.id, {
    title,
    color,
    fields: [
      { name: 'Case', value: `#${record.caseId}`, inline: true },
      { name: 'Target', value: `<@${record.targetId}>`, inline: true },
      { name: 'Moderator', value: `<@${record.issuerId}>`, inline: true },
      { name: 'Reason', value: record.reason },
    ],
  });
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

export async function warnMember(guild: Guild, actor: GuildMember, target: GuildMember, reason: string, evidence: string[] = []) {
  const check = await hierarchyCheck(actor, target, { requiredBucket: 'moderation' });
  if (!check.ok) throw new Error(check.reason);
  const record = await createCase({ guildId: guild.id, category: 'discord-moderation', action: 'warn', targetId: target.id, issuerId: actor.id, reason: cleanUserText(reason, 1000), evidence });
  await target.send(`You received a Discord warning in **${guild.name}**. Case #${record.caseId}. Reason: ${cleanUserText(reason, 700)}`).catch(() => undefined);
  await logCase(guild, 'Discord Warning', record);
  return record;
}

export async function kickMember(guild: Guild, actor: GuildMember, target: GuildMember, reason: string) {
  const check = await hierarchyCheck(actor, target, { requiredBucket: 'moderation' });
  if (!check.ok) throw new Error(check.reason);
  if (!target.kickable) throw new Error('The bot cannot kick this member because of Discord role hierarchy or permissions.');
  const record = await createCase({ guildId: guild.id, category: 'discord-moderation', action: 'kick', targetId: target.id, issuerId: actor.id, reason: cleanUserText(reason, 1000), metadata: { executionStatus: 'pending' } });
  await target.send(`You were kicked from **${guild.name}**. Case #${record.caseId}. Reason: ${cleanUserText(reason, 700)}`).catch(() => undefined);
  try {
    await target.kick(`Case #${record.caseId}: ${cleanUserText(reason, 400)}`);
    record.metadata = { ...(record.metadata ?? {}), executionStatus: 'completed' };
    await record.save();
  } catch (error: any) {
    record.revoked = true; record.revokedBy = actor.id; record.revokedAt = new Date(); record.revokedReason = 'Kick execution failed.';
    record.metadata = { ...(record.metadata ?? {}), executionStatus: 'failed', error: String(error?.message || error) };
    await record.save().catch(() => undefined);
    throw error;
  }
  await logCase(guild, 'Discord Kick', record);
  return record;
}

export async function banUser(guild: Guild, actor: GuildMember, target: User, reason: string, deleteMessageSeconds = 0) {
  const member = await guild.members.fetch(target.id).catch(() => null);
  if (member) {
    const check = await hierarchyCheck(actor, member, { requiredBucket: 'moderation' });
    if (!check.ok) throw new Error(check.reason);
    if (!member.bannable) throw new Error('The bot cannot ban this member because of Discord role hierarchy or permissions.');
  } else if (!(await canUse(actor, 'moderation'))) {
    throw new Error('You do not have configured moderation permission.');
  }
  const record = await createCase({ guildId: guild.id, category: 'discord-moderation', action: 'ban', targetId: target.id, issuerId: actor.id, reason: cleanUserText(reason, 1000), metadata: { deleteMessageSeconds, executionStatus: 'pending' } });
  await target.send(`You were banned from **${guild.name}**. Case #${record.caseId}. Reason: ${cleanUserText(reason, 700)}`).catch(() => undefined);
  try {
    await guild.members.ban(target.id, { deleteMessageSeconds, reason: `Case #${record.caseId}: ${cleanUserText(reason, 400)}` });
    record.metadata = { ...(record.metadata ?? {}), executionStatus: 'completed' };
    await record.save();
  } catch (error: any) {
    record.revoked = true; record.revokedBy = actor.id; record.revokedAt = new Date(); record.revokedReason = 'Ban execution failed.';
    record.metadata = { ...(record.metadata ?? {}), executionStatus: 'failed', error: String(error?.message || error) };
    await record.save().catch(() => undefined);
    throw error;
  }
  await logCase(guild, 'Discord Ban', record);
  return record;
}

export async function timeoutMember(guild: Guild, actor: GuildMember, target: GuildMember, durationMs: number, reason: string) {
  const check = await hierarchyCheck(actor, target, { requiredBucket: 'moderation' });
  if (!check.ok) throw new Error(check.reason);
  if (!target.moderatable) throw new Error('The bot cannot timeout this member because of Discord role hierarchy or permissions.');
  const record = await createCase({ guildId: guild.id, category: 'discord-moderation', action: 'timeout', targetId: target.id, issuerId: actor.id, reason: cleanUserText(reason, 1000), metadata: { durationMs, executionStatus: 'pending' } });
  try {
    await target.timeout(durationMs, `Case #${record.caseId}: ${cleanUserText(reason, 400)}`);
    record.metadata = { ...(record.metadata ?? {}), executionStatus: 'completed' };
    await record.save();
  } catch (error: any) {
    record.revoked = true; record.revokedBy = actor.id; record.revokedAt = new Date(); record.revokedReason = 'Timeout execution failed.';
    record.metadata = { ...(record.metadata ?? {}), executionStatus: 'failed', error: String(error?.message || error) };
    await record.save().catch(() => undefined);
    throw error;
  }
  await target.send(`You were timed out in **${guild.name}**. Case #${record.caseId}. Reason: ${cleanUserText(reason, 700)}`).catch(() => undefined);
  await logCase(guild, 'Discord Timeout', record);
  return record;
}
