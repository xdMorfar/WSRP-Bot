import type { GuildMember } from 'discord.js';
import { env } from '../config';
import { getGuildConfig } from '../services/configService';
import type { PermissionBucket } from '../types';

function hasAnyRole(member: GuildMember, roleIds: string[]) {
  return roleIds.some((id) => member.roles.cache.has(id));
}

export async function canUse(member: GuildMember, bucket: PermissionBucket): Promise<boolean> {
  const cfg = await getGuildConfig(member.guild.id);
  if (member.id === member.guild.ownerId) return true;
  if (env.bootstrapAdminIds.has(member.id)) return true;
  if (bucket === 'setup') return hasAnyRole(member, cfg.roles.authorizedAdminRoleIds ?? []);
  if (bucket === 'management') return hasAnyRole(member, [...(cfg.roles.authorizedAdminRoleIds ?? []), ...(cfg.roles.managementRoleIds ?? [])]);
  if (bucket === 'hr') return hasAnyRole(member, [...(cfg.roles.authorizedAdminRoleIds ?? []), ...(cfg.roles.managementRoleIds ?? []), ...(cfg.roles.hrRoleIds ?? [])]);
  if (bucket === 'ia') return hasAnyRole(member, [...(cfg.roles.authorizedAdminRoleIds ?? []), ...(cfg.roles.managementRoleIds ?? []), ...(cfg.roles.iaRoleIds ?? [])]);
  if (bucket === 'moderation') return hasAnyRole(member, [...(cfg.roles.authorizedAdminRoleIds ?? []), ...(cfg.roles.managementRoleIds ?? []), ...(cfg.roles.moderatorRoleIds ?? [])]);
  return false;
}

export async function getConfiguredRank(member: GuildMember) {
  const cfg = await getGuildConfig(member.guild.id);
  const ranks = [...(cfg.staffRanks ?? [])].sort((a: any, b: any) => b.level - a.level);
  return ranks.find((rank: any) => member.roles.cache.has(rank.roleId)) ?? null;
}

export async function hierarchyCheck(actor: GuildMember, target: GuildMember, opts?: { allowSelf?: boolean; requiredBucket?: PermissionBucket }) {
  if (!opts?.allowSelf && actor.id === target.id) return { ok: false, reason: 'You cannot perform this action on yourself.' };
  if (actor.id === actor.guild.ownerId) return { ok: true };
  if (target.id === actor.guild.ownerId) return { ok: false, reason: 'The server owner cannot be targeted.' };

  if (opts?.requiredBucket && !(await canUse(actor, opts.requiredBucket))) return { ok: false, reason: 'You do not have the configured permission for this action.' };

  if (actor.roles.highest.position <= target.roles.highest.position) {
    return { ok: false, reason: 'Discord role hierarchy prevents you from acting on an equal or higher member.' };
  }

  const actorRank = await getConfiguredRank(actor);
  const targetRank = await getConfiguredRank(target);
  if (targetRank && !actorRank) {
    return { ok: false, reason: 'The target has a configured staff rank, but you do not. Configure/assign your staff rank before acting on ranked staff.' };
  }
  if (actorRank && targetRank && actorRank.level <= targetRank.level) {
    return { ok: false, reason: 'The configured staff hierarchy prevents actions against an equal or higher staff rank.' };
  }
  return { ok: true, actorRankLevel: actorRank?.level, targetRankLevel: targetRank?.level };
}
