import type { Guild } from 'discord.js';
import { GuildConfigModel } from '../models/GuildConfig';

export async function getGuildConfig(guildId: string) {
  return GuildConfigModel.findOneAndUpdate(
    { guildId },
    { $setOnInsert: { guildId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

export async function updateGuildConfig(guildId: string, update: Record<string, unknown>) {
  return GuildConfigModel.findOneAndUpdate({ guildId }, update, { new: true, upsert: true, setDefaultsOnInsert: true });
}

export function clearConfigCache(_guildId: string) {
  // Kept for compatibility with earlier builds. Configuration is read directly
  // from MongoDB so changes are immediately visible across interactions/processes.
}

export async function validateGuildConfig(guild: Guild) {
  const cfg = await getGuildConfig(guild.id);
  const issues: string[] = [];

  const channelEntries = Object.entries(cfg.channels?.toObject?.() ?? cfg.channels ?? {});
  for (const [key, value] of channelEntries) {
    if (!value) continue;
    const ch = guild.channels.cache.get(String(value));
    if (!ch) issues.push(`Configured channel \`${key}\` (${value}) does not exist or is not visible to the bot.`);
  }

  const roleBuckets = ['authorizedAdminRoleIds', 'managementRoleIds', 'hrRoleIds', 'iaRoleIds', 'moderatorRoleIds', 'staffAccessRoleIds', 'staffDivisionRoleIds'];
  for (const bucket of roleBuckets) {
    for (const roleId of cfg.roles?.[bucket] ?? []) {
      if (!guild.roles.cache.has(roleId)) issues.push(`Configured role in \`${bucket}\` (${roleId}) does not exist or is not visible to the bot.`);
    }
  }
  for (const rank of cfg.staffRanks ?? []) {
    if (!guild.roles.cache.has(rank.roleId)) issues.push(`Staff rank \`${rank.name}\` points to missing role ${rank.roleId}.`);
  }

  const me = guild.members.me;
  if (!me) issues.push('The bot member object is unavailable.');
  else {
    const required = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'ManageMessages'];
    for (const perm of required) {
      if (!me.permissions.has(perm as any)) issues.push(`Bot is missing guild permission: **${perm}**.`);
    }
    if (!me.permissions.has('ManageRoles')) issues.push('Bot is missing **Manage Roles** (needed for staff ranks, join roles and suspensions).');
    if (!me.permissions.has('ManageChannels')) issues.push('Bot is missing **Manage Channels** (needed for tickets and lockdown).');
    if (!me.permissions.has('ModerateMembers')) issues.push('Bot is missing **Moderate Members** (needed for timeouts/automod escalation).');
    if (!me.permissions.has('KickMembers')) issues.push('Bot is missing **Kick Members**.');
    if (!me.permissions.has('BanMembers')) issues.push('Bot is missing **Ban Members**.');
  }

  if (!cfg.roles?.authorizedAdminRoleIds?.length) issues.push('No authorized administrator role is configured. The server owner can still run /setup.');
  if (!cfg.staffRanks?.length) issues.push('No staff rank hierarchy has been configured.');
  if (!cfg.channels?.moderationLogChannelId) issues.push('No moderation log channel is configured.');
  if (!cfg.channels?.ticketLogChannelId) issues.push('No ticket transcript/log channel is configured.');
  if (!cfg.channels?.promotionChannelId) issues.push('No promotions announcement channel is configured.');
  if (!cfg.channels?.infractionChannelId) issues.push('No staff infractions announcement channel is configured.');
  if (!cfg.channels?.applicationsChannelId) issues.push('No applications panel channel is configured.');
  if (!cfg.channels?.ticketPanelChannelId) issues.push('No assistance/tickets panel channel is configured.');

  return { cfg, issues };
}
