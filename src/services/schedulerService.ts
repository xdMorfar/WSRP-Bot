import type { Client } from 'discord.js';
import { TimedActionModel } from '../models/TimedAction';
import { StaffProfileModel } from '../models/StaffProfile';
import { LeaveRequestModel } from '../models/LeaveRequest';
import { getGuildConfig } from './configService';
import { logger } from '../logger';
import { TicketModel } from '../models/Ticket';
import { closeTicket } from './ticketService';
import { CaseModel } from '../models/Case';

async function processSuspension(client: Client, action: any) {
  const guild = client.guilds.cache.get(action.guildId);
  if (!guild) return false;
  const member = await guild.members.fetch(action.userId).catch(() => null);
  const profile = await StaffProfileModel.findOne({ guildId: action.guildId, userId: action.userId });
  if (!member || profile?.employmentStatus === 'terminated') return true;
  const cfg = await getGuildConfig(guild.id);
  const rankRoleIds = new Set((cfg.staffRanks ?? []).map((r: any) => r.roleId));
  const validStaffRoles = new Set([
    ...rankRoleIds,
    ...(cfg.roles.staffAccessRoleIds ?? []),
    ...(cfg.roles.staffDivisionRoleIds ?? []),
  ]);
  const captured = (action.payload?.roles ?? []).filter((id: string) => validStaffRoles.has(id) && guild.roles.cache.has(id));
  const hasCurrentRank = [...rankRoleIds].some((id: string) => member.roles.cache.has(id));
  const roles = captured.filter((id: string) => !rankRoleIds.has(id) || !hasCurrentRank);
  if (roles.length) await member.roles.add(roles, `Automatic suspension expiry (case #${action.payload?.caseId ?? '?'})`).catch(() => undefined);
  await StaffProfileModel.findOneAndUpdate({ guildId: guild.id, userId: member.id }, { $set: { employmentStatus: 'active' } }, { upsert: true });
  await member.send(`Your staff suspension in **${guild.name}** has expired.`).catch(() => undefined);
  return true;
}

async function processReminder(client: Client, action: any) {
  const user = await client.users.fetch(action.userId).catch(() => null);
  if (!user) return true;
  await user.send(`⏰ Reminder: ${String(action.payload?.message ?? '').slice(0, 1800)}`).catch(() => undefined);
  return true;
}

async function processLoa(client: Client, action: any) {
  const req = action.payload?.requestId ? await LeaveRequestModel.findOne({ guildId: action.guildId, requestId: action.payload.requestId }) : null;
  if (!req || req.status !== 'approved') return true;
  const guild = client.guilds.cache.get(action.guildId);
  if (!guild) return false;
  const member = await guild.members.fetch(action.userId).catch(() => null);
  const cfg = await getGuildConfig(guild.id);
  if (member && cfg.roles.loaRoleId && member.roles.cache.has(cfg.roles.loaRoleId)) await member.roles.remove(cfg.roles.loaRoleId, 'LOA expired').catch(() => undefined);
  req.status = 'expired';
  await req.save();
  await member?.send(`Your approved leave of absence in **${guild.name}** has expired.`).catch(() => undefined);
  return true;
}



const lastCleanup = new Map<string, number>();

async function processRetention(client: Client) {
  for (const guild of client.guilds.cache.values()) {
    const previous = lastCleanup.get(guild.id) ?? 0;
    if (Date.now() - previous < 6 * 60 * 60_000) continue;
    lastCleanup.set(guild.id, Date.now());
    const cfg = await getGuildConfig(guild.id);

    const evidenceCutoff = new Date(Date.now() - Number(cfg.retention.evidenceDays || 180) * 86_400_000);
    await CaseModel.updateMany(
      { guildId: guild.id, createdAt: { $lte: evidenceCutoff }, 'evidence.0': { $exists: true } },
      { $set: { evidence: [] }, $push: { amendments: { authorId: client.user?.id ?? 'system', at: new Date(), note: 'Evidence links removed by configured retention policy.' } } },
    );

    const staffCutoff = new Date(Date.now() - Number(cfg.retention.staffRecordDays || 365) * 86_400_000);
    await CaseModel.deleteMany({ guildId: guild.id, category: { $in: ['staff', 'staff-infraction'] }, createdAt: { $lte: staffCutoff } });

    const ticketCutoff = new Date(Date.now() - Number(cfg.retention.ticketDays || 90) * 86_400_000);
    const expiredTickets = await TicketModel.find({ guildId: guild.id, status: 'closed', closedAt: { $lte: ticketCutoff } }).limit(100);
    const logChannel = cfg.channels.ticketLogChannelId ? guild.channels.cache.get(cfg.channels.ticketLogChannelId) : null;
    for (const ticket of expiredTickets) {
      if (ticket.transcriptMessageId && logChannel?.isTextBased()) {
        const msg = await logChannel.messages.fetch(ticket.transcriptMessageId).catch(() => null);
        await msg?.delete().catch(() => undefined);
      }
      await TicketModel.deleteOne({ _id: ticket._id });
    }
  }
}

async function processTicketInactivity(client: Client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    const hours = Number(cfg.limits.ticketInactivityHours || 0);
    if (!hours || hours < 1) continue;
    const botMember = guild.members.me;
    if (!botMember) continue;
    const now = Date.now();
    const closeBefore = new Date(now - hours * 3_600_000);
    const remindBefore = new Date(now - hours * 3_600_000 * 0.75);

    const stale = await TicketModel.find({ guildId: guild.id, status: 'open', lastActivityAt: { $lte: closeBefore } }).limit(10);
    for (const ticket of stale) {
      try {
        await closeTicket({ guild, ticketId: ticket.ticketId, actor: botMember, reason: `Automatically closed after ${hours} hours of inactivity.`, force: true });
      } catch (e) {
        logger.warn(`Automatic close failed for ticket #${ticket.ticketId}`, e);
      }
    }

    const reminders = await TicketModel.find({ guildId: guild.id, status: 'open', lastActivityAt: { $lte: remindBefore, $gt: closeBefore }, inactivityRemindedAt: { $exists: false } }).limit(20);
    for (const ticket of reminders) {
      const channel = guild.channels.cache.get(ticket.channelId);
      if (channel?.isTextBased()) {
        await channel.send({ content: `⏳ This ticket has been inactive. It will automatically close after **${hours} hours** without new activity.`, allowedMentions: { parse: [] } }).catch(() => undefined);
      }
      ticket.inactivityRemindedAt = new Date();
      await ticket.save();
    }
  }
}

export function startScheduler(client: Client) {
  const run = async () => {
    const actions = await TimedActionModel.find({ status: 'pending', executeAt: { $lte: new Date() } }).limit(50);
    for (const action of actions) {
      try {
        let done = false;
        if (action.type === 'suspension') done = await processSuspension(client, action);
        if (action.type === 'reminder') done = await processReminder(client, action);
        if (action.type === 'loa') done = await processLoa(client, action);
        if (done) {
          action.status = 'completed';
          await action.save();
        }
      } catch (error) {
        logger.error(`Timed action ${action.id} failed`, error);
      }
    }
    await processTicketInactivity(client);
    await processRetention(client);
  };
  void run();
  return setInterval(() => void run().catch((e) => logger.error('Scheduler pass failed', e)), 60_000);
}
