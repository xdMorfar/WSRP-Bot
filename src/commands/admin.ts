import { randomUUID } from 'crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { BotCommand } from '../types';
import { canUse } from '../utils/permissions';
import { replyError, replyOk } from '../utils/interaction';
import { getGuildConfig } from '../services/configService';
import { validHttpUrl, parseColor, cleanUserText } from '../utils/safe';
import { PendingActionModel } from '../models/PendingAction';
import { PanelModel } from '../models/Panel';
import { GuildConfigModel } from '../models/GuildConfig';
import { brandedEmbed } from '../utils/embeds';

async function requireManagement(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.member) {
    await replyError(interaction, 'This command can only be used in a server.');
    return false;
  }
  if (!(await canUse(interaction.member as GuildMember, 'management'))) {
    await replyError(interaction, 'Management permission is required.');
    return false;
  }
  return true;
}

export const applicationCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('application')
    .setDescription('Configure Melonly application information panels. No submissions are handled by this bot.')
    .addSubcommand((s) =>
      s
        .setName('configure')
        .setDescription('Create or update an application entry.')
        .addStringOption((o) => o.setName('key').setDescription('Stable key, e.g. staff').setRequired(true).setMaxLength(50))
        .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('description').setDescription('Description').setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('requirements').setDescription('Requirements').setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('status').setDescription('Manual open/closed status').setRequired(true).addChoices({ name: 'Open', value: 'open' }, { name: 'Closed', value: 'closed' }))
        .addStringOption((o) => o.setName('url').setDescription('Melonly URL; required before opening').setMaxLength(500))
        .addStringOption((o) => o.setName('button_label').setDescription('Link button label').setMaxLength(80))
        .addStringOption((o) => o.setName('instructions').setDescription('Optional instructions').setMaxLength(1000))
        .addStringOption((o) => o.setName('image_url').setDescription('Optional banner/image URL').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Manually open or close an application entry.')
        .addStringOption((o) => o.setName('key').setDescription('Application key').setRequired(true))
        .addStringOption((o) => o.setName('status').setDescription('New status').setRequired(true).addChoices({ name: 'Open', value: 'open' }, { name: 'Closed', value: 'closed' })),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List configured application entries.')),
  async execute(interaction) {
    if (!(await requireManagement(interaction))) return;
    const sub = interaction.options.getSubcommand();
    const cfg = await getGuildConfig(interaction.guild!.id);
    if (sub === 'list') {
      const embed = await brandedEmbed(interaction.guild!.id, {
        title: 'Configured Applications',
        description: (cfg.applications ?? []).length
          ? cfg.applications.map((a: any) => `**${a.title}** (\`${a.key}\`) — ${a.status}${a.url ? ' — URL configured' : ' — no URL'}`).join('\n')
          : 'No application entries are configured.',
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const key = interaction.options.getString('key', true).toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 50);
    const doc = await GuildConfigModel.findOne({ guildId: interaction.guild!.id });
    if (!doc) return replyError(interaction, 'Guild configuration could not be loaded.');
    const apps = doc.applications as any[];
    const existing = apps.find((a: any) => a.key === key);
    if (sub === 'status') {
      if (!existing) return replyError(interaction, 'Application key not found.');
      const status = interaction.options.getString('status', true);
      if (status === 'open' && !validHttpUrl(existing.url)) return replyError(interaction, 'Configure a valid Melonly URL before opening this application panel.');
      existing.status = status;
      await doc.save();
      return replyOk(interaction, `${existing.title} is now ${status}. Republish/update the application dashboard with /dashboard applications.`);
    }

    const url = interaction.options.getString('url') || existing?.url;
    const status = interaction.options.getString('status', true);
    if (status === 'open' && !validHttpUrl(url)) return replyError(interaction, 'A valid http(s) Melonly URL is required when status is open.');
    const next = {
      key,
      title: cleanUserText(interaction.options.getString('title', true), 100),
      description: cleanUserText(interaction.options.getString('description', true), 1000),
      requirements: cleanUserText(interaction.options.getString('requirements', true), 1000),
      instructions: cleanUserText(interaction.options.getString('instructions') || existing?.instructions || '', 1000) || undefined,
      status,
      url: validHttpUrl(url) ? url : undefined,
      buttonLabel: cleanUserText(interaction.options.getString('button_label') || existing?.buttonLabel || 'Apply on Melonly', 80),
      imageUrl: validHttpUrl(interaction.options.getString('image_url')) ? interaction.options.getString('image_url') : existing?.imageUrl,
    };
    if (existing) Object.assign(existing, next);
    else apps.push(next);
    await doc.save();
    await replyOk(interaction, `Application entry \`${key}\` saved. Applications still go through Melonly; the bot stores only panel information and links.`);
  },
};

function parseFields(raw?: string | null) {
  if (!raw) return [];
  return raw.split(';').map((item) => {
    const [name, value, inline] = item.split('|');
    return { name: cleanUserText(name || 'Field', 256), value: cleanUserText(value || '—', 1024), inline: String(inline).toLowerCase() === 'true' };
  }).filter((f) => f.name && f.value).slice(0, 25);
}

function parseButtons(raw?: string | null) {
  if (!raw) return [];
  return raw.split(';').map((item) => {
    const [label, url] = item.split('|');
    return { label: cleanUserText(label || 'Link', 80), url };
  }).filter((b) => validHttpUrl(b.url)).slice(0, 10);
}

function makePreview(data: any) {
  const embed = new EmbedBuilder().setTitle(data.title).setDescription(data.description).setColor(data.color);
  if (data.footer) embed.setFooter({ text: data.footer });
  if (validHttpUrl(data.imageUrl)) embed.setImage(data.imageUrl);
  if (validHttpUrl(data.thumbnailUrl)) embed.setThumbnail(data.thumbnailUrl);
  if (data.fields?.length) embed.addFields(data.fields);
  return embed;
}

function embedCharacterCount(data: any) {
  return String(data.title ?? '').length + String(data.description ?? '').length + String(data.footer ?? '').length +
    (data.fields ?? []).reduce((sum: number, f: any) => sum + String(f.name ?? '').length + String(f.value ?? '').length, 0);
}

function makeLinkRows(buttons: any[]) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const b of buttons.slice(i, i + 5)) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(b.label).setURL(b.url));
    rows.push(row);
  }
  return rows.slice(0, 5);
}

export const embedCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Administrator embed builder with preview, editing, and templates.')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a draft and preview it before publishing.')
        .addStringOption((o) => o.setName('key').setDescription('Unique panel key').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setMaxLength(256))
        .addStringOption((o) => o.setName('description').setDescription('Description').setRequired(true).setMaxLength(4000))
        .addChannelOption((o) => o.setName('channel').setDescription('Destination').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName('color').setDescription('Hex color, e.g. #1f4f8f'))
        .addStringOption((o) => o.setName('fields').setDescription('Name|Value|true;Name|Value|false').setMaxLength(3000))
        .addStringOption((o) => o.setName('buttons').setDescription('Label|https://url;Label|https://url').setMaxLength(2000))
        .addStringOption((o) => o.setName('image_url').setDescription('Banner image URL').setMaxLength(500))
        .addStringOption((o) => o.setName('thumbnail_url').setDescription('Thumbnail URL').setMaxLength(500))
        .addStringOption((o) => o.setName('footer').setDescription('Footer').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit an existing published panel and preview the changes.')
        .addStringOption((o) => o.setName('key').setDescription('Existing panel key').setRequired(true))
        .addStringOption((o) => o.setName('title').setDescription('New title').setMaxLength(256))
        .addStringOption((o) => o.setName('description').setDescription('New description').setMaxLength(4000))
        .addStringOption((o) => o.setName('color').setDescription('New hex color'))
        .addStringOption((o) => o.setName('fields').setDescription('Replace fields: Name|Value|true;...').setMaxLength(3000))
        .addStringOption((o) => o.setName('buttons').setDescription('Replace link buttons: Label|https://url;...').setMaxLength(2000))
        .addStringOption((o) => o.setName('image_url').setDescription('New banner image URL').setMaxLength(500))
        .addStringOption((o) => o.setName('footer').setDescription('New footer').setMaxLength(500)),
    )
    .addSubcommand((s) => s.setName('save-template').setDescription('Save an existing panel as a reusable template.').addStringOption((o) => o.setName('key').setDescription('Panel key').setRequired(true)).addStringOption((o) => o.setName('template_key').setDescription('Template key').setRequired(true)))
    .addSubcommand((s) => s.setName('from-template').setDescription('Preview/publish a saved template to a destination channel.').addStringOption((o) => o.setName('template_key').setDescription('Template key').setRequired(true)).addStringOption((o) => o.setName('new_key').setDescription('New published panel key').setRequired(true)).addChannelOption((o) => o.setName('channel').setDescription('Destination').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))),
  async execute(interaction) {
    if (!(await requireManagement(interaction))) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'save-template') {
      const panel = await PanelModel.findOne({ guildId: interaction.guild!.id, key: interaction.options.getString('key', true) });
      if (!panel) return replyError(interaction, 'Panel not found.');
      const templateKey = `template:${interaction.options.getString('template_key', true)}`;
      await PanelModel.findOneAndUpdate({ guildId: interaction.guild!.id, key: templateKey }, { $set: { type: 'template', data: panel.data, template: true, published: false, updatedBy: interaction.user.id }, $setOnInsert: { createdBy: interaction.user.id } }, { upsert: true, new: true });
      return replyOk(interaction, `Template saved as \`${templateKey}\`.`);
    }

    let data: any;
    let channelId: string;
    let key: string;
    if (sub === 'create') {
      const cfg = await getGuildConfig(interaction.guild!.id);
      key = interaction.options.getString('key', true).toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      channelId = interaction.options.getChannel('channel', true).id;
      data = {
        title: cleanUserText(interaction.options.getString('title', true), 256),
        description: cleanUserText(interaction.options.getString('description', true), 4000),
        color: parseColor(interaction.options.getString('color'), cfg.branding.primaryColor),
        fields: parseFields(interaction.options.getString('fields')),
        buttons: parseButtons(interaction.options.getString('buttons')),
        imageUrl: validHttpUrl(interaction.options.getString('image_url')) ? interaction.options.getString('image_url') : undefined,
        thumbnailUrl: validHttpUrl(interaction.options.getString('thumbnail_url')) ? interaction.options.getString('thumbnail_url') : undefined,
        footer: cleanUserText(interaction.options.getString('footer') || cfg.branding.footerText || '', 500),
      };
    } else if (sub === 'edit') {
      key = interaction.options.getString('key', true);
      const panel = await PanelModel.findOne({ guildId: interaction.guild!.id, key });
      if (!panel || !panel.channelId) return replyError(interaction, 'Published panel not found.');
      channelId = panel.channelId;
      data = { ...(panel.data ?? {}) };
      const cfg = await getGuildConfig(interaction.guild!.id);
      if (interaction.options.getString('title')) data.title = cleanUserText(interaction.options.getString('title')!, 256);
      if (interaction.options.getString('description')) data.description = cleanUserText(interaction.options.getString('description')!, 4000);
      if (interaction.options.getString('color')) data.color = parseColor(interaction.options.getString('color'), cfg.branding.primaryColor);
      if (interaction.options.getString('fields') !== null) data.fields = parseFields(interaction.options.getString('fields'));
      if (interaction.options.getString('buttons') !== null) data.buttons = parseButtons(interaction.options.getString('buttons'));
      if (interaction.options.getString('image_url')) data.imageUrl = validHttpUrl(interaction.options.getString('image_url')) ? interaction.options.getString('image_url') : undefined;
      if (interaction.options.getString('footer')) data.footer = cleanUserText(interaction.options.getString('footer')!, 500);
    } else {
      const template = await PanelModel.findOne({ guildId: interaction.guild!.id, key: `template:${interaction.options.getString('template_key', true)}`, template: true });
      if (!template) return replyError(interaction, 'Template not found.');
      key = interaction.options.getString('new_key', true).toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      channelId = interaction.options.getChannel('channel', true).id;
      data = { ...(template.data ?? {}) };
    }

    if (!data.title || !data.description) return replyError(interaction, 'Panel needs both a title and description.');
    if (embedCharacterCount(data) > 5800) return replyError(interaction, 'This embed is too large for Discord. Shorten the description/fields so the total is under Discord’s embed character limit.');
    const token = randomUUID();
    await PendingActionModel.create({ token, guildId: interaction.guild!.id, actorId: interaction.user.id, kind: 'custom-panel', payload: { key, channelId, data }, expiresAt: new Date(Date.now() + 10 * 60_000) });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`pending:confirm:${token}`).setLabel('Publish / Update').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`pending:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    await interaction.reply({ content: `Preview for panel \`${key}\` → <#${channelId}>. Only configured valid HTTP(S) link buttons are included; missing/invalid links are omitted.`, embeds: [makePreview(data)], components: [row, ...makeLinkRows(data.buttons ?? [])].slice(0, 5), ephemeral: true, allowedMentions: { parse: [] } });
  },
};

export const automodCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure built-in bot protection. Discord native AutoMod rules remain compatible.')
    .addSubcommand((s) => s.setName('status').setDescription('View AutoMod configuration.'))
    .addSubcommand((s) => s.setName('toggle').setDescription('Enable or disable bot AutoMod.').addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true)))
    .addSubcommand((s) => s.setName('word').setDescription('Add or remove a blocked word/phrase.').addStringOption((o) => o.setName('action').setDescription('Action').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' })).addStringOption((o) => o.setName('value').setDescription('Word or phrase').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('domain').setDescription('Add or remove a blocked/suspicious domain.').addStringOption((o) => o.setName('action').setDescription('Action').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' })).addStringOption((o) => o.setName('value').setDescription('Domain').setRequired(true).setMaxLength(200)))
    .addSubcommand((s) => s.setName('thresholds').setDescription('Set spam/mention/timeout thresholds.').addIntegerOption((o) => o.setName('spam_messages').setDescription('Messages within spam window').setMinValue(3).setMaxValue(30)).addIntegerOption((o) => o.setName('spam_window').setDescription('Spam window seconds').setMinValue(2).setMaxValue(60)).addIntegerOption((o) => o.setName('mention_limit').setDescription('Mentions in one message').setMinValue(2).setMaxValue(50)).addIntegerOption((o) => o.setName('timeout_minutes').setDescription('Timeout duration').setMinValue(0).setMaxValue(10080))),
  async execute(interaction) {
    if (!(await requireManagement(interaction))) return;
    const sub = interaction.options.getSubcommand();
    const doc = await GuildConfigModel.findOne({ guildId: interaction.guild!.id });
    if (!doc) return replyError(interaction, 'Guild configuration unavailable.');
    if (sub === 'status') {
      const a = doc.automod;
      const embed = await brandedEmbed(interaction.guild!.id, { title: 'AutoMod Status', description: `Enabled: **${a.enabled}**\nSpam: **${a.spamEnabled}** — ${a.spamMessages} messages / ${a.spamWindowSeconds}s\nRepeated messages: **${a.repeatEnabled}** — ${a.repeatCount} repeats\nMention spam: **${a.mentionSpamEnabled}** — limit ${a.mentionLimit}\nInvite filter: **${a.invitesEnabled}**\nTimeout: **${a.timeoutMinutes} minutes**\nBlocked words: **${a.blockedWords.length}**\nBlocked domains: **${a.blockedDomains.length}**\n\nRapid-join detection logs alerts only; it does not mass-ban based on join spikes or account age.` });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    if (sub === 'toggle') doc.automod.enabled = interaction.options.getBoolean('enabled', true);
    if (sub === 'word' || sub === 'domain') {
      const action = interaction.options.getString('action', true);
      const value = interaction.options.getString('value', true).trim().toLowerCase();
      const arr = sub === 'word' ? doc.automod.blockedWords : doc.automod.blockedDomains;
      if (action === 'add' && !arr.includes(value)) arr.push(value);
      if (action === 'remove') {
        const index = arr.indexOf(value);
        if (index >= 0) arr.splice(index, 1);
      }
    }
    if (sub === 'thresholds') {
      const spam = interaction.options.getInteger('spam_messages');
      const window = interaction.options.getInteger('spam_window');
      const mentions = interaction.options.getInteger('mention_limit');
      const timeout = interaction.options.getInteger('timeout_minutes');
      if (spam !== null) doc.automod.spamMessages = spam;
      if (window !== null) doc.automod.spamWindowSeconds = window;
      if (mentions !== null) doc.automod.mentionLimit = mentions;
      if (timeout !== null) doc.automod.timeoutMinutes = timeout;
    }
    await doc.save();
    await replyOk(interaction, 'AutoMod configuration updated.');
  },
};

export const adminCommands: BotCommand[] = [applicationCommand, embedCommand, automodCommand];
