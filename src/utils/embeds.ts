import { EmbedBuilder, type APIEmbedField } from 'discord.js';
import { getGuildConfig } from '../services/configService';

export async function brandedEmbed(guildId: string, opts?: { title?: string; description?: string; color?: number; imageUrl?: string; thumbnailUrl?: string | null; showDefaultThumbnail?: boolean; showTimestamp?: boolean; fields?: APIEmbedField[] }) {
  const cfg = await getGuildConfig(guildId);
  const embed = new EmbedBuilder()
    .setColor(opts?.color ?? cfg.branding.primaryColor)
    .setFooter({ text: cfg.branding.footerText || 'Powered by Wisconsin State Roleplay', iconURL: cfg.branding.logoUrl || undefined });
  if (opts?.showTimestamp !== false) embed.setTimestamp();
  if (opts?.title) embed.setTitle(opts.title);
  if (opts?.description) embed.setDescription(opts.description);
  if (opts?.imageUrl) embed.setImage(opts.imageUrl);
  if (opts?.thumbnailUrl) embed.setThumbnail(opts.thumbnailUrl);
  else if (opts?.showDefaultThumbnail !== false && cfg.branding.logoUrl) embed.setThumbnail(cfg.branding.logoUrl);
  if (opts?.fields?.length) embed.addFields(opts.fields.slice(0, 25));
  return embed;
}

export function truncate(value: string, length: number) {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1))}…`;
}
