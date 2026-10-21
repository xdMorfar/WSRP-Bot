import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
  mongoUri: required('MONGODB_URI'),
  registerCommands: (process.env.REGISTER_COMMANDS ?? 'false').toLowerCase() === 'true',
  bootstrapAdminIds: new Set(
    (process.env.BOOTSTRAP_ADMIN_IDS ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  ),
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  erlcApiKey: process.env.ERLC_API_KEY?.trim() || undefined,
};
