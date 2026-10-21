import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { SessionModel } from '../models/Session';
import { getGuildConfig } from './configService';
import { brandedEmbed } from '../utils/embeds';
import { canUse } from '../utils/permissions';

export async function buildSessionEmbed(guildId: string, session: any) {
  const cfg = await getGuildConfig(guildId);
  return brandedEmbed(guildId, {
    title: `${cfg.branding.name} | Session ${session.active ? 'Active' : 'Status'}`,
    color: session.active ? cfg.branding.successColor : cfg.branding.primaryColor,
    description: session.active
      ? `A roleplay session is currently active. Join the private server and follow all published session rules.`
      : 'There is currently no active roleplay session.',
    fields: session.active
      ? [
          { name: 'Server', value: cfg.server.privateServerName || cfg.branding.name, inline: true },
          { name: 'Join Code', value: cfg.server.joinCode ? `\`${cfg.server.joinCode}\`` : 'Not configured', inline: true },
          { name: 'Host', value: session.hostId ? `<@${session.hostId}>` : 'Unknown', inline: true },
          { name: 'Started', value: session.startedAt ? `<t:${Math.floor(new Date(session.startedAt).getTime() / 1000)}:R>` : 'Unknown', inline: true },
          { name: 'Join Instructions', value: cfg.server.joinCode ? `Open ER:LC, choose private servers, and join **${cfg.server.privateServerName || cfg.branding.name}** with code \`${cfg.server.joinCode}\`.` : 'Ask the session host for current join information.' },
          ...(cfg.server.gameRules?.length ? [{ name: 'Session Rules', value: cfg.server.gameRules.slice(0, 6).map((r: string, i: number) => `${i + 1}. ${r}`).join('\n').slice(0, 1024) }] : []),
        ]
      : [],
  });
}

export async function startSession(guild: Guild, actor: GuildMember) {
  if (!(await canUse(actor, 'management'))) throw new Error('You do not have permission to start sessions.');
  const cfg = await getGuildConfig(guild.id);
  const channel = cfg.channels.sessionChannelId ? guild.channels.cache.get(cfg.channels.sessionChannelId) : null;
  if (!channel?.isTextBased()) throw new Error('The session announcement channel is not configured or unavailable.');

  const existing = await SessionModel.findOne({ guildId: guild.id });
  if (existing?.active) throw new Error('A session is already active.');
  const startedAt = new Date();
  let state: any;
  try {
    state = await SessionModel.findOneAndUpdate(
      { guildId: guild.id, active: { $ne: true } },
      { $set: { active: true, hostId: actor.id, startedAt, endedAt: null, voters: [], voteThresholdNotified: false } },
      { upsert: true, new: true },
    );
  } catch (error: any) {
    if (error?.code === 11000) throw new Error('A session was started by someone else at the same time.');
    throw error;
  }
  if (!state) throw new Error('A session was started by someone else at the same time.');

  try {
    const embed = await buildSessionEmbed(guild.id, state);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('session:vote').setLabel('Session Vote').setStyle(ButtonStyle.Primary),
    );
    const sent = await channel.send({
      content: cfg.roles.sessionPingRoleId ? `<@&${cfg.roles.sessionPingRoleId}>` : undefined,
      embeds: [embed],
      components: [row],
      allowedMentions: { roles: cfg.roles.sessionPingRoleId ? [cfg.roles.sessionPingRoleId] : [] },
    });
    state.messageId = sent.id;
    state.channelId = sent.channelId;
    await state.save();
    return state;
  } catch (error) {
    await SessionModel.updateOne(
      { _id: state._id, active: true, hostId: actor.id, startedAt },
      { $set: { active: false, endedAt: new Date() }, $unset: { messageId: 1, channelId: 1 } },
    ).catch(() => undefined);
    throw error;
  }
}

export async function endSession(guild: Guild, actor: GuildMember) {
  if (!(await canUse(actor, 'management'))) throw new Error('You do not have permission to end sessions.');
  const state = await SessionModel.findOne({ guildId: guild.id });
  if (!state?.active) throw new Error('There is no active session.');
  state.active = false;
  state.endedAt = new Date();
  await state.save();
  const cfg = await getGuildConfig(guild.id);
  const channel = cfg.channels.sessionChannelId ? guild.channels.cache.get(cfg.channels.sessionChannelId) : null;
  if (channel?.isTextBased()) {
    const embed = await brandedEmbed(guild.id, { title: `${cfg.branding.name} | Session Ended`, color: cfg.branding.warningColor, description: `The roleplay session has ended. Thank you to everyone who participated.\n\nEnded by <@${actor.id}>.` });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  return state;
}

export async function addSessionVote(guild: Guild, userId: string) {
  const cfg = await getGuildConfig(guild.id);
  let state = await SessionModel.findOne({ guildId: guild.id });
  if (!state) state = await SessionModel.create({ guildId: guild.id, active: false, voters: [] });
  if (state.active) throw new Error('A session is already active; a vote is not needed.');
  if (state.lastVoteOpenedAt && Date.now() - new Date(state.lastVoteOpenedAt).getTime() > Number(cfg.limits.sessionVoteCooldownHours ?? 6) * 60 * 60 * 1000) {
    state.voters = [];
    state.voteThresholdNotified = false;
  }
  if (state.voters.includes(userId)) throw new Error('You have already voted for a session in the current vote window.');
  state.voters.push(userId);
  state.lastVoteOpenedAt = new Date();
  if (state.voters.length >= cfg.limits.sessionVoteThreshold && !state.voteThresholdNotified) {
    state.voteThresholdNotified = true;
    const channel = cfg.channels.sessionChannelId ? guild.channels.cache.get(cfg.channels.sessionChannelId) : null;
    if (channel?.isTextBased()) await channel.send({ content: `📣 Session vote threshold reached: **${state.voters.length}/${cfg.limits.sessionVoteThreshold}**. Management can start a session with \`/session start\`.`, allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  await state.save();
  return { count: state.voters.length, threshold: cfg.limits.sessionVoteThreshold };
}
