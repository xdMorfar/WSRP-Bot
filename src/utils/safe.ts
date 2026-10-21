import { escapeMarkdown } from 'discord.js';

export function cleanUserText(input: string, max = 1000): string {
  return input
    .replace(/@everyone/gi, '@\u200beveryone')
    .replace(/@here/gi, '@\u200bhere')
    .replace(/<@&\d+>/g, '[role mention]')
    .slice(0, max);
}

export function safeInline(input: string, max = 256): string {
  return escapeMarkdown(cleanUserText(input, max)).replace(/`/g, '\\`');
}

export function validHttpUrl(value?: string | null): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function parseIdList(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^\d{15,22}$/.test(x)))];
}

export function parseColor(input?: string | null, fallback = 0x1f4f8f): number {
  if (!input) return fallback;
  const normalized = input.replace('#', '').trim();
  const n = Number.parseInt(normalized, 16);
  return Number.isFinite(n) && n >= 0 && n <= 0xffffff ? n : fallback;
}
