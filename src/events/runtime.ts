import type { Client } from 'discord.js';
import { TicketModel } from '../models/Ticket';
import { getGuildConfig } from '../services/configService';
import { logger } from '../logger';

export function installRuntimeListeners(client: Client) {
  client.on('messageCreate', (message) => {
    if (!message.guild || message.author.bot) return;
    void TicketModel.updateOne(
      { guildId: message.guild.id, channelId: message.channelId, status: 'open' },
      { $set: { lastActivityAt: new Date() }, $unset: { inactivityRemindedAt: 1 } },
    ).catch((e) => logger.warn('Failed to update ticket activity', e));
  });

  client.on('guildMemberAdd', (member) => {
    void (async () => {
      const cfg = await getGuildConfig(member.guild.id);
      if (cfg.roles.memberRoleId) await member.roles.add(cfg.roles.memberRoleId, 'Configured join role').catch(() => undefined);
      const welcome = cfg.channels.welcomeChannelId ? member.guild.channels.cache.get(cfg.channels.welcomeChannelId) : null;
      if (welcome?.isTextBased() && cfg.welcomeMessage) {
        const text = String(cfg.welcomeMessage).replaceAll('{user}', `<@${member.id}>`).replaceAll('{server}', member.guild.name);
        await welcome.send({ content: text, allowedMentions: { users: [member.id] } }).catch(() => undefined);
      }
    })().catch((e) => logger.error('Welcome handler failed', e));
  });
}
