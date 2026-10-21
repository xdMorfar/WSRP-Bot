import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  GuildMember,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

export interface BotCommand {
  data: { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction, client: Client) => Promise<unknown>;
}

export interface RankConfig {
  roleId: string;
  name: string;
  level: number;
}

export interface TicketCategoryConfig {
  key: string;
  label: string;
  description: string;
  supportRoleIds: string[];
  restrictedRoleIds: string[];
  questions: string[];
}

export interface ApplicationConfig {
  key: string;
  title: string;
  description: string;
  requirements: string;
  instructions?: string;
  status: 'open' | 'closed';
  url?: string;
  buttonLabel: string;
  imageUrl?: string;
}

export type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;
export type AnyManagedInteraction = ComponentInteraction | ModalSubmitInteraction;
export type PermissionBucket = 'setup' | 'management' | 'hr' | 'ia' | 'moderation';

export function isGuildMember(member: unknown): member is GuildMember {
  return !!member && typeof member === 'object' && 'roles' in member;
}
