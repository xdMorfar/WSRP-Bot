import type { RepliableInteraction } from 'discord.js';

export async function replyError(interaction: RepliableInteraction, message: string) {
  const payload = { content: `❌ ${message}`, ephemeral: true as const, allowedMentions: { parse: [] as any[] } };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => undefined);
  else await interaction.reply(payload).catch(() => undefined);
}

export async function replyOk(interaction: RepliableInteraction, message: string) {
  const payload = { content: `✅ ${message}`, ephemeral: true as const, allowedMentions: { parse: [] as any[] } };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => undefined);
  else await interaction.reply(payload).catch(() => undefined);
}
