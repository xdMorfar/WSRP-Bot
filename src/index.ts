import {
  Client,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { env } from './config';
import { connectDatabase, disconnectDatabase } from './db';
import { logger } from './logger';
import { commandMap, commands } from './commands';
import { handleComponent, handleModal } from './interactions';
import { installAutomodListeners } from './services/automodService';
import { installRuntimeListeners } from './events/runtime';
import { startScheduler } from './services/schedulerService';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
  allowedMentions: { parse: [] },
});

client.once('ready', async () => {
  logger.info(`Logged in as ${client.user?.tag} in ${client.guilds.cache.size} guild(s)`);
  if (env.registerCommands && client.application) {
    const body = commands.map((c) => c.data.toJSON()) as any[];
    if (env.guildId) {
      const guild = client.guilds.cache.get(env.guildId) ?? (await client.guilds.fetch(env.guildId).catch(() => null));
      if (!guild) logger.error(`DISCORD_GUILD_ID ${env.guildId} is not available to the bot.`);
      else {
        await guild.commands.set(body);
        logger.info(`Registered ${body.length} guild slash commands.`);
      }
    } else {
      await client.application.commands.set(body);
      logger.info(`Registered ${body.length} global slash commands.`);
    }
  }
  startScheduler(client);
});

client.on('interactionCreate', (interaction) => {
  void (async () => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction, client);
        return;
      }
      if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isUserSelectMenu()) {
        await handleComponent(interaction);
        return;
      }
      if (interaction.isModalSubmit()) {
        await handleModal(interaction);
      }
    } catch (error: any) {
      logger.error(`Interaction failed (${interaction.id})`, error);
      if (interaction.isRepliable()) {
        const payload = { content: `❌ An unexpected error occurred. Reference: \`${interaction.id}\``, ephemeral: true as const };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => undefined);
        else await interaction.reply(payload).catch(() => undefined);
      }
    }
  })();
});

client.on('error', (error) => logger.error('Discord client error', error));
client.on('warn', (warning) => logger.warn('Discord client warning', warning));

installAutomodListeners(client);
installRuntimeListeners(client);

async function shutdown(signal: string) {
  logger.info(`Received ${signal}; shutting down.`);
  client.destroy();
  await disconnectDatabase().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

async function main() {
  await connectDatabase();
  await client.login(env.token);
}

main().catch((error) => {
  logger.error('Fatal startup error', error);
  process.exit(1);
});
