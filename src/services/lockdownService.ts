import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember, type TextChannel } from 'discord.js';
import { LockdownStateModel } from '../models/LockdownState';
import { canUse } from '../utils/permissions';

function previousSendState(channel: TextChannel | any, everyoneId: string): boolean | null {
  const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
  if (!overwrite) return null;
  const bit = PermissionFlagsBits.SendMessages;
  if (overwrite.allow.has(bit)) return true;
  if (overwrite.deny.has(bit)) return false;
  return null;
}

export async function startLockdown(guild: Guild, actor: GuildMember) {
  if (!(await canUse(actor, 'management'))) throw new Error('You do not have permission to start emergency lockdown.');
  const existing = await LockdownStateModel.findOne({ guildId: guild.id });
  if (existing?.active) throw new Error('Emergency lockdown is already active.');

  const snapshots: any[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) continue;
    snapshots.push({ channelId: channel.id, sendMessages: previousSendState(channel, guild.roles.everyone.id) });
    await (channel as TextChannel).permissionOverwrites
      .edit(guild.roles.everyone, { SendMessages: false }, { reason: `Emergency lockdown by ${actor.user.tag}` })
      .catch(() => undefined);
  }

  await LockdownStateModel.findOneAndUpdate(
    { guildId: guild.id },
    { $set: { active: true, startedBy: actor.id, startedAt: new Date(), channels: snapshots } },
    { upsert: true, new: true },
  );
  return snapshots.length;
}

export async function endLockdown(guild: Guild, actor: GuildMember) {
  if (!(await canUse(actor, 'management'))) throw new Error('You do not have permission to end emergency lockdown.');
  const state = await LockdownStateModel.findOne({ guildId: guild.id });
  if (!state?.active) throw new Error('Emergency lockdown is not active.');

  let restored = 0;
  for (const snap of state.channels ?? []) {
    const channel = guild.channels.cache.get(snap.channelId);
    if (!channel || !('permissionOverwrites' in channel)) continue;
    await channel.permissionOverwrites
      .edit(guild.roles.everyone, { SendMessages: snap.sendMessages ?? null }, { reason: `Emergency lockdown restored by ${actor.user.tag}` })
      .catch(() => undefined);
    restored++;
  }

  state.active = false;
  await state.save();
  return restored;
}
