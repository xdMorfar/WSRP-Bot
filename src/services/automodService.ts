import type { Client, GuildMember, Message } from 'discord.js';
import { createCase } from './caseService';
import { getGuildConfig } from './configService';
import { logger } from '../logger';

const messageWindows = new Map<string, number[]>();
const repeatState = new Map<string, { content: string; count: number; at: number }>();
const joinWindows = new Map<string, number[]>();

function exempt(message: Message, cfg: any) {
  if (!message.member) return true;
  if ((cfg.automod.exemptChannelIds ?? []).includes(message.channelId)) return true;
  return (cfg.automod.exemptRoleIds ?? []).some((id: string) => message.member!.roles.cache.has(id));
}

async function trigger(message: Message, rule: string, reason: string, cfg: any) {
  await message.delete().catch(() => undefined);
  const member = message.member;
  if (!member) return;
  const record = await createCase({ guildId: message.guild!.id, category: 'automod', action: rule, targetId: member.id, issuerId: message.client.user.id, reason });
  if (member.moderatable && cfg.automod.timeoutMinutes > 0) {
    await member.timeout(cfg.automod.timeoutMinutes * 60_000, `AutoMod case #${record.caseId}: ${reason}`).catch(() => undefined);
  }
  const log = cfg.channels.moderationLogChannelId ? message.guild!.channels.cache.get(cfg.channels.moderationLogChannelId) : null;
  if (log?.isTextBased()) {
    await log.send({ content: `**AutoMod case #${record.caseId}** — <@${member.id}> triggered **${rule}** in <#${message.channelId}>. ${reason}`, allowedMentions: { parse: [] } }).catch(() => undefined);
  }
}

export async function handleAutomodMessage(message: Message) {
  if (!message.guild || message.author.bot) return;
  const cfg = await getGuildConfig(message.guild.id);
  if (!cfg.automod.enabled || exempt(message, cfg)) return;
  const content = message.content.trim();
  const lower = content.toLowerCase();

  if (cfg.automod.mentionSpamEnabled) {
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    if (mentions >= cfg.automod.mentionLimit) return trigger(message, 'mention-spam', `Message contained ${mentions} mentions.` , cfg);
  }

  if (cfg.automod.invitesEnabled && /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i.test(content)) {
    return trigger(message, 'unapproved-invite', 'Discord invite links are not allowed here.', cfg);
  }

  const blockedWord = (cfg.automod.blockedWords ?? []).find((word: string) => word && lower.includes(word.toLowerCase()));
  if (blockedWord) return trigger(message, 'blocked-word', 'Message contained a configured blocked term.', cfg);

  const blockedDomain = (cfg.automod.blockedDomains ?? []).find((domain: string) => domain && lower.includes(domain.toLowerCase()));
  if (blockedDomain) return trigger(message, 'blocked-domain', 'Message contained a configured blocked or suspicious domain.', cfg);

  const key = `${message.guild.id}:${message.author.id}`;
  if (cfg.automod.spamEnabled) {
    const now = Date.now();
    const arr = (messageWindows.get(key) ?? []).filter((t) => now - t < cfg.automod.spamWindowSeconds * 1000);
    arr.push(now);
    messageWindows.set(key, arr);
    if (arr.length >= cfg.automod.spamMessages) {
      messageWindows.delete(key);
      return trigger(message, 'message-spam', `${arr.length} messages were sent within ${cfg.automod.spamWindowSeconds} seconds.`, cfg);
    }
  }

  if (cfg.automod.repeatEnabled && lower.length >= 4) {
    const prev = repeatState.get(key);
    const next = prev && prev.content === lower && Date.now() - prev.at < 60_000 ? { content: lower, count: prev.count + 1, at: Date.now() } : { content: lower, count: 1, at: Date.now() };
    repeatState.set(key, next);
    if (next.count >= cfg.automod.repeatCount) {
      repeatState.delete(key);
      return trigger(message, 'repeated-message', `The same message was repeated ${next.count} times.`, cfg);
    }
  }
}

export async function handleRapidJoin(member: GuildMember) {
  const cfg = await getGuildConfig(member.guild.id);
  if (!cfg.automod.enabled || !cfg.automod.rapidJoinEnabled) return;
  const now = Date.now();
  const arr = (joinWindows.get(member.guild.id) ?? []).filter((t) => now - t < cfg.automod.rapidJoinWindowSeconds * 1000);
  arr.push(now);
  joinWindows.set(member.guild.id, arr);
  if (arr.length >= cfg.automod.rapidJoinCount) {
    const log = cfg.channels.moderationLogChannelId ? member.guild.channels.cache.get(cfg.channels.moderationLogChannelId) : null;
    if (log?.isTextBased()) {
      await log.send({
        content: `⚠️ **Rapid join activity detected:** ${arr.length} joins within ${cfg.automod.rapidJoinWindowSeconds} seconds. No members were automatically banned. Review the server and use /lockdown if necessary.`,
        allowedMentions: { parse: [] },
      }).catch(() => undefined);
    }
    joinWindows.set(member.guild.id, []);
  }
}

export function installAutomodListeners(client: Client) {
  client.on('messageCreate', (message) => void handleAutomodMessage(message).catch((e) => logger.error('AutoMod message handler failed', e)));
  client.on('guildMemberAdd', (member) => void handleRapidJoin(member).catch((e) => logger.error('Rapid join handler failed', e)));
}
