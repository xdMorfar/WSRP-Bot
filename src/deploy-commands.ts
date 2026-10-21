import { REST, Routes } from 'discord.js';
import { env } from './config';
import { commands } from './commands';

async function main() {
  const rest = new REST({ version: '10' }).setToken(env.token);
  const body = commands.map((c) => c.data.toJSON());
  if (env.guildId) {
    await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body });
    console.log(`Registered ${body.length} guild commands in ${env.guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(env.clientId), { body });
    console.log(`Registered ${body.length} global commands.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
