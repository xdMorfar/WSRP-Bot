import type { BotCommand } from '../types';
import { setupCommand, validateCommand } from './setup';
import { dashboardCommand } from './dashboard';
import { ticketCommand } from './tickets';
import { staffCommand } from './staff';
import { moderationCommands } from './moderation';
import { sessionCommand } from './session';
import { utilityCommands } from './utility';
import { economyCommands } from './economy';
import { adminCommands } from './admin';

export const commands: BotCommand[] = [
  setupCommand,
  validateCommand,
  dashboardCommand,
  ticketCommand,
  staffCommand,
  ...moderationCommands,
  sessionCommand,
  ...utilityCommands,
  ...economyCommands,
  ...adminCommands,
];

export const commandMap = new Map(commands.map((command) => [command.data.name, command]));
