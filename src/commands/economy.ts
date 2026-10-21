import mongoose from 'mongoose';
import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import type { BotCommand } from '../types';
import { getGuildConfig } from '../services/configService';
import { EconomyModel } from '../models/Economy';
import { replyError, replyOk } from '../utils/interaction';
import { canUse } from '../utils/permissions';
import { createCase } from '../services/caseService';
import { GuildConfigModel } from '../models/GuildConfig';

async function cfgOrError(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await replyError(interaction, 'This command can only be used in a server.');
    return null;
  }
  const cfg = await getGuildConfig(interaction.guild.id);
  if (!cfg.economy.enabled) {
    await replyError(interaction, 'The optional fictional server economy is disabled.');
    return null;
  }
  return cfg;
}

async function ensure(guildId: string, userId: string) {
  return EconomyModel.findOneAndUpdate({ guildId, userId }, { $setOnInsert: { guildId, userId, balance: 0 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

export const balanceCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('balance').setDescription('View fictional server currency balance.').addUserOption((o) => o.setName('user').setDescription('User to view')),
  async execute(interaction) {
    const cfg = await cfgOrError(interaction);
    if (!cfg || !interaction.guild) return;
    const user = interaction.options.getUser('user') ?? interaction.user;
    const account = await ensure(interaction.guild.id, user.id);
    await interaction.reply({ content: `**${user.tag}** has **${account.balance.toLocaleString()} ${cfg.economy.currencyName}**.`, ephemeral: true });
  },
};

export const dailyCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('daily').setDescription('Claim the daily fictional server currency reward.'),
  async execute(interaction) {
    const cfg = await cfgOrError(interaction);
    if (!cfg || !interaction.guild) return;
    await ensure(interaction.guild.id, interaction.user.id);
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const updated = await EconomyModel.findOneAndUpdate(
      { guildId: interaction.guild.id, userId: interaction.user.id, $or: [{ lastDailyAt: { $exists: false } }, { lastDailyAt: { $lte: cutoff } }] },
      { $inc: { balance: cfg.economy.dailyAmount }, $set: { lastDailyAt: new Date() } },
      { new: true },
    );
    if (!updated) return replyError(interaction, 'Your daily reward is still on cooldown.');
    await replyOk(interaction, `Daily reward claimed: ${cfg.economy.dailyAmount} ${cfg.economy.currencyName}. Balance: ${updated.balance}.`);
  },
};

export const workCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('work').setDescription('Earn fictional server currency with a cooldown.'),
  async execute(interaction) {
    const cfg = await cfgOrError(interaction);
    if (!cfg || !interaction.guild) return;
    await ensure(interaction.guild.id, interaction.user.id);
    const cutoff = new Date(Date.now() - 60 * 60_000);
    const amount = Math.floor(Math.random() * (cfg.economy.workMax - cfg.economy.workMin + 1)) + cfg.economy.workMin;
    const updated = await EconomyModel.findOneAndUpdate(
      { guildId: interaction.guild.id, userId: interaction.user.id, $or: [{ lastWorkAt: { $exists: false } }, { lastWorkAt: { $lte: cutoff } }] },
      { $inc: { balance: amount }, $set: { lastWorkAt: new Date() } },
      { new: true },
    );
    if (!updated) return replyError(interaction, 'Work is on a 1-hour cooldown.');
    await replyOk(interaction, `You earned ${amount} ${cfg.economy.currencyName}. Balance: ${updated.balance}.`);
  },
};

export const payCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('pay').setDescription('Transfer fictional server currency.').addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    const cfg = await cfgOrError(interaction);
    if (!cfg || !interaction.guild) return;
    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    if (user.bot || user.id === interaction.user.id) return replyError(interaction, 'Choose another non-bot user.');
    await ensure(interaction.guild.id, interaction.user.id);
    await ensure(interaction.guild.id, user.id);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const debited = await EconomyModel.findOneAndUpdate(
          { guildId: interaction.guild!.id, userId: interaction.user.id, balance: { $gte: amount } },
          { $inc: { balance: -amount } },
          { new: true, session },
        );
        if (!debited) throw new Error('INSUFFICIENT');
        await EconomyModel.updateOne({ guildId: interaction.guild!.id, userId: user.id }, { $inc: { balance: amount } }, { session });
      });
      await replyOk(interaction, `Transferred ${amount} ${cfg.economy.currencyName} to ${user.tag}.`);
    } catch (e: any) {
      if (e.message === 'INSUFFICIENT') await replyError(interaction, 'Insufficient balance.');
      else await replyError(interaction, 'Transfer failed safely; no partial transfer should remain.');
    } finally {
      await session.endSession();
    }
  },
};

export const leaderboardCommand: BotCommand = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('View the fictional server currency leaderboard.'),
  async execute(interaction) {
    const cfg = await cfgOrError(interaction);
    if (!cfg || !interaction.guild) return;
    const top = await EconomyModel.find({ guildId: interaction.guild.id }).sort({ balance: -1 }).limit(10);
    await interaction.reply({ content: top.length ? top.map((a: any, i: number) => `${i + 1}. <@${a.userId}> — **${a.balance.toLocaleString()} ${cfg.economy.currencyName}**`).join('\n') : 'No economy accounts yet.', ephemeral: true, allowedMentions: { parse: [] } });
  },
};

export const economyAdminCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Optional fictional economy administration.')
    .addSubcommand((s) => s.setName('toggle').setDescription('Enable or disable the optional economy.').addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true)))
    .addSubcommand((s) => s.setName('settings').setDescription('Configure fictional currency and rewards.').addStringOption((o) => o.setName('currency').setDescription('Currency name').setMaxLength(40)).addIntegerOption((o) => o.setName('daily').setDescription('Daily reward').setMinValue(0).setMaxValue(1000000)).addIntegerOption((o) => o.setName('work_min').setDescription('Work minimum').setMinValue(0).setMaxValue(1000000)).addIntegerOption((o) => o.setName('work_max').setDescription('Work maximum').setMinValue(0).setMaxValue(1000000)))
    .addSubcommand((s) => s.setName('adjust').setDescription('Adjust a fictional balance with a reason and audit case.').addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('Positive or negative adjustment').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000))),
  async execute(interaction) {
    if (!interaction.guild || !interaction.member) return replyError(interaction, 'This command can only be used in a server.');
    if (!(await canUse(interaction.member as GuildMember, 'management'))) return replyError(interaction, 'Management permission is required.');
    const sub = interaction.options.getSubcommand();
    const doc = await GuildConfigModel.findOne({ guildId: interaction.guild.id });
    if (!doc) return replyError(interaction, 'Guild configuration unavailable. Run /setup first.');

    if (sub === 'toggle') {
      doc.economy.enabled = interaction.options.getBoolean('enabled', true);
      await doc.save();
      return replyOk(interaction, `Optional economy ${doc.economy.enabled ? 'enabled' : 'disabled'}.`);
    }
    if (sub === 'settings') {
      const currency = interaction.options.getString('currency');
      const daily = interaction.options.getInteger('daily');
      const workMin = interaction.options.getInteger('work_min');
      const workMax = interaction.options.getInteger('work_max');
      if (currency) doc.economy.currencyName = currency;
      if (daily !== null) doc.economy.dailyAmount = daily;
      if (workMin !== null) doc.economy.workMin = workMin;
      if (workMax !== null) doc.economy.workMax = workMax;
      if (doc.economy.workMax < doc.economy.workMin) return replyError(interaction, 'work_max must be greater than or equal to work_min.');
      await doc.save();
      return replyOk(interaction, 'Economy settings updated.');
    }
    if (!doc.economy.enabled) return replyError(interaction, 'Enable the optional economy before adjusting balances.');
    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    await ensure(interaction.guild.id, user.id);
    const updated = await EconomyModel.findOneAndUpdate(
      { guildId: interaction.guild.id, userId: user.id, balance: { $gte: Math.max(0, -amount) } },
      { $inc: { balance: amount } },
      { new: true },
    );
    if (!updated) return replyError(interaction, 'That adjustment would create a negative balance.');
    const record = await createCase({ guildId: interaction.guild.id, category: 'economy-admin', action: 'balance-adjust', targetId: user.id, issuerId: interaction.user.id, reason: interaction.options.getString('reason', true), metadata: { amount, resultingBalance: updated.balance } });
    await replyOk(interaction, `Balance adjusted by ${amount}. New balance: ${updated.balance}. Audit case #${record.caseId}.`);
  },
};

export const economyCommands: BotCommand[] = [balanceCommand, dailyCommand, workCommand, payCommand, leaderboardCommand, economyAdminCommand];
