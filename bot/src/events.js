// Система ивентов: запуск, красивая карточка, кнопка участия, напоминания и уведомление о начале.
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags, ChannelType,
  GuildScheduledEventEntityType as ET, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus as ES,
} from 'discord.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { cfg, L2 } from './config.js';
import { data, getUser, save } from './store.js';
import { embed, msg, post, activity, hasLevel, parseDuration, sendLog } from './util.js';

const eph = MessageFlags.Ephemeral;
const DIR = new URL('../data/events/', import.meta.url);
mkdirSync(DIR, { recursive: true });
const imgPath = (id) => new URL(`${id}.img`, DIR).pathname;
const STAFF = [cfg.roles.seniorEvent, cfg.roles.event, ...L2];
const TYPES = {
  tournament: { emoji: '🏆', name: 'Турнир' }, quiz: { emoji: '🧠', name: 'Квиз' }, movie: { emoji: '🎬', name: 'Кино-вечер' },
  contest: { emoji: '🎨', name: 'Творческий конкурс' }, stream: { emoji: '📡', name: 'Стрим' }, hangout: { emoji: '💬', name: 'Посиделки' },
  other: { emoji: '✨', name: 'Ивент' },
};
const MSK = 3 * 36e5;

export const commands = [new SlashCommandBuilder().setName('event').setDescription('Ивенты сервера')
  .addSubcommand((s) => s.setName('create').setDescription('Создать ивент (для организаторов)')
    .addStringOption((o) => o.setName('title').setDescription('Название').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('start').setDescription('Когда: 2h, 1d или 25.12 19:30 (по МСК)').setRequired(true))
    .addStringOption((o) => o.setName('type').setDescription('Тип ивента').setRequired(true).addChoices(...Object.entries(TYPES).map(([value, t]) => ({ name: `${t.emoji} ${t.name}`, value }))))
    .addStringOption((o) => o.setName('description').setDescription('Описание').setMaxLength(1000))
    .addChannelOption((o) => o.setName('place').setDescription('Голосовой канал или трибуна').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addStringOption((o) => o.setName('where').setDescription('Или текстом, если нет канала (например, стрим на Twitch)').setMaxLength(100))
    .addIntegerOption((o) => o.setName('prize1').setDescription('Награда за 1 место (монеты)').setMinValue(1).setMaxValue(100000))
    .addIntegerOption((o) => o.setName('prize2').setDescription('Награда за 2 место (монеты)').setMinValue(1).setMaxValue(100000))
    .addIntegerOption((o) => o.setName('prize3').setDescription('Награда за 3 место (монеты)').setMinValue(1).setMaxValue(100000))
    .addStringOption((o) => o.setName('prize').setDescription('Дополнительный приз текстом').setMaxLength(100))
    .addChannelOption((o) => o.setName('rules').setDescription('Канал с правилами ивента (по умолчанию общие правила)').addChannelTypes(ChannelType.GuildText))
    .addIntegerOption((o) => o.setName('coins').setDescription('Награда за участие (монеты каждому участнику)').setMinValue(1).setMaxValue(5000))
    .addIntegerOption((o) => o.setName('limit').setDescription('Лимит участников').setMinValue(2).setMaxValue(500))
    .addIntegerOption((o) => o.setName('duration').setDescription('Длительность в минутах (по умолчанию 120)').setMinValue(15).setMaxValue(1440))
    .addAttachmentOption((o) => o.setName('image').setDescription('Картинка-баннер ивента')))
  .addSubcommand((s) => s.setName('list').setDescription('Ближайшие ивенты'))
  .addSubcommand((s) => s.setName('start').setDescription('Начать ивент сейчас').addIntegerOption((o) => o.setName('id').setDescription('ID ивента').setRequired(true)))
  .addSubcommand((s) => s.setName('end').setDescription('Завершить ивент и выдать награды')
    .addIntegerOption((o) => o.setName('id').setDescription('ID ивента').setRequired(true))
    .addUserOption((o) => o.setName('first').setDescription('Победитель, 1 место'))
    .addUserOption((o) => o.setName('second').setDescription('2 место'))
    .addUserOption((o) => o.setName('third').setDescription('3 место')))
  .addSubcommand((s) => s.setName('cancel').setDescription('Отменить ивент').addIntegerOption((o) => o.setName('id').setDescription('ID ивента').setRequired(true)))
  .setContexts(0).toJSON()];

/** «2h», «1d» или «25.12 19:30» / «25.12.2026 19:30» по МСК. */
export function parseWhen(s) {
  const rel = parseDuration(s);
  if (rel) return Date.now() + rel;
  const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const [, d, mo, y, h, mi] = m.map(Number);
  const year = y || new Date(Date.now() + MSK).getUTCFullYear();
  let t = Date.UTC(year, mo - 1, d, h, mi) - MSK;
  if (!y && t < Date.now() - 864e5) t = Date.UTC(year + 1, mo - 1, d, h, mi) - MSK;
  return Number.isNaN(t) ? null : t;
}

const ts = (ms, f) => `<t:${Math.floor(ms / 1000)}:${f}>`;
const status = { scheduled: '🗓️ Скоро', live: '🔴 Идёт сейчас', ended: '✅ Завершён', cancelled: '❌ Отменён' };

const extOf = (ct) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[ct] ?? 'png');
const imgName = (ev) => `event-${ev.id}.${ev.imageExt || 'png'}`;
const placeText = (ev) => (ev.placeId ? `<#${ev.placeId}>` : ev.where || 'на сервере');
const MEDAL = ['🥇', '🥈', '🥉'];

function card(ev) {
  const T = TYPES[ev.type] ?? TYPES.other;
  const color = { live: 0x6fa380, cancelled: 0xa05a5a, ended: 0x7a7a85 }[ev.status];
  const bullets = [
    `**Когда:** ${ts(ev.startAt, 'F')} (${ts(ev.startAt, 'R')})`,
    `**Где:** ${placeText(ev)}`,
    `**Правила ивента** - <#${ev.rulesId || cfg.channels.rules}>`,
    `**Участвуют:** ${ev.participants.length}${ev.limit ? ` / ${ev.limit}` : ''}`,
  ];
  if (ev.prize) bullets.push(`**Дополнительный приз:** ${ev.prize}`);
  if (ev.winners?.length) bullets.push(`**Победители:** ${ev.winners.map((w, k) => `${MEDAL[k]} <@${w}>`).join(' ')}`);
  const rewards = [];
  (ev.prizes ?? []).forEach((p, k) => { if (p) rewards.push(`**${k + 1} место:** ${p} 🪙`); });
  if (ev.coins) rewards.push(`**Награда за участие:** ${ev.coins} 🪙`);
  return activity({
    title: `${T.emoji} ${T.name} — ${ev.title}`, subtitle: status[ev.status], description: ev.description, bullets, rewards,
    image: ev.hasImage ? `attachment://${imgName(ev)}` : null, footer: `🎙️ Ведущий: <@${ev.hostId}> · Ивент #${ev.id}`, color,
  });
}
function rows(ev) {
  const off = ev.status === 'ended' || ev.status === 'cancelled';
  const r = [new ButtonBuilder().setCustomId(`ev:join:${ev.id}`).setLabel('Участвую').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(off)];
  if (ev.placeId && !off) r.push(new ButtonBuilder().setLabel('Войти').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${cfg.guildId}/${ev.placeId}`));
  if (ev.discordEventId) r.push(new ButtonBuilder().setLabel('Событие Discord').setEmoji('📅').setStyle(ButtonStyle.Link).setURL(`https://discord.com/events/${cfg.guildId}/${ev.discordEventId}`));
  return [new ActionRowBuilder().addComponents(...r)];
}
const imageFile = (ev) => (ev.hasImage && existsSync(imgPath(ev.id)) ? [new AttachmentBuilder(readFileSync(imgPath(ev.id)), { name: imgName(ev) })] : undefined);

async function refresh(client, ev) {
  try {
    const ch = await client.channels.fetch(cfg.channels.events);
    const m = await ch.messages.fetch(ev.messageId);
    await m.edit({ ...post(card(ev), rows(ev)), files: undefined, attachments: [...m.attachments.values()] });
  } catch (e) { console.error('event refresh', e.message); }
}
async function announce(client, text, ev, pingAll = true) {
  const ch = await client.channels.fetch(cfg.channels.events);
  const users = ev.participants.slice(0, 80);
  const ping = [pingAll ? `<@&${cfg.roles.eventsPing}>` : null, ...users.map((u) => `<@${u}>`)].filter(Boolean).join(' ');
  const T = TYPES[ev.type] ?? TYPES.other;
  const container = activity({ title: text, bullets: [`**${T.emoji} ${ev.title}**`, `**Где:** ${placeText(ev)}`], footer: `Ивент #${ev.id}`,
    color: text.includes('начался') ? 0x6fa380 : undefined });
  const row = ev.placeId && pingAll ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Войти').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${cfg.guildId}/${ev.placeId}`))] : [];
  await ch.send(post(container, row, { ping: ping || undefined, allowedMentions: { roles: pingAll ? [cfg.roles.eventsPing] : [], users } }));
}

async function startEvent(client, ev) {
  if (ev.status !== 'scheduled') return;
  ev.status = 'live'; ev.startedAt = Date.now(); save();
  const guild = await client.guilds.fetch(cfg.guildId);
  if (ev.discordEventId) await guild.scheduledEvents.edit(ev.discordEventId, { status: ES.Active }).catch(() => {});
  await announce(client, '🔴 Ивент начался!', ev);
  await refresh(client, ev);
}
async function endEvent(client, ev, quiet = false, winners = []) {
  if (ev.status === 'ended' || ev.status === 'cancelled') return;
  ev.status = 'ended'; ev.endedAt = Date.now();
  ev.winners = winners.slice(0, 3);
  ev.winners.forEach((id, k) => { const p = ev.prizes?.[k]; if (p) getUser(id).coins += p; });
  if (ev.coins) for (const id of ev.participants) getUser(id).coins += ev.coins;
  save();
  const guild = await client.guilds.fetch(cfg.guildId);
  if (ev.discordEventId) await guild.scheduledEvents.edit(ev.discordEventId, { status: ES.Completed }).catch(() => {});
  await refresh(client, ev);
  if (!quiet) {
    const ch = await client.channels.fetch(cfg.channels.events);
    const bullets = [`**${ev.title}** — спасибо всем, кто пришёл!`];
    if (ev.winners.length) bullets.push(`**Победители:** ${ev.winners.map((w, k) => `${MEDAL[k]} <@${w}>${ev.prizes?.[k] ? ` (+${ev.prizes[k]} 🪙)` : ''}`).join(' ')}`);
    if (ev.coins && ev.participants.length) bullets.push(`**Участникам начислено:** по ${ev.coins} 🪙`);
    await ch.send(post(activity({ title: '✅ Ивент завершён', bullets, footer: `Ивент #${ev.id}`, color: 0x7a7a85 }), [], { allowedMentions: { parse: [] } })).catch(() => {});
  }
  await sendLog(client, embed(`Ивент #${ev.id} завершён`, `${ev.title} · участников: ${ev.participants.length}`));
}
async function cancelEvent(client, ev) {
  ev.status = 'cancelled'; save();
  const guild = await client.guilds.fetch(cfg.guildId);
  if (ev.discordEventId) await guild.scheduledEvents.delete(ev.discordEventId).catch(() => {});
  ev.discordEventId = null;
  await refresh(client, ev);
  if (ev.participants.length) await announce(client, '❌ Ивент отменён', ev, false);
}

export function startEventScheduler(client) {
  const tick = async () => {
    const now = Date.now();
    for (const ev of Object.values(data.events)) {
      try {
        if (ev.status === 'scheduled') {
          if (!ev.reminded && ev.startAt - now <= 60 * 6e4 && ev.startAt - now > 5 * 6e4 && ev.startAt - ev.createdAt > 65 * 6e4) {
            ev.reminded = true; save(); if (ev.participants.length) await announce(client, '⏰ Ивент начнётся через час', ev, false);
          }
          if (now >= ev.startAt) { if (now - ev.startAt > ev.duration * 6e4) { ev.status = 'ended'; save(); await refresh(client, ev); } else await startEvent(client, ev); }
        } else if (ev.status === 'live' && now >= ev.startAt + ev.duration * 6e4 + 30 * 6e4) await endEvent(client, ev);
      } catch (e) { console.error('event tick', ev.id, e.message); }
    }
  };
  tick(); setInterval(tick, 30e3);
}

const find = (i) => data.events[i.options.getInteger('id')];
export async function handleCommand(i) {
  if (i.commandName !== 'event') return false;
  const sub = i.options.getSubcommand();
  if (sub === 'list') {
    const list = Object.values(data.events).filter((e) => ['scheduled', 'live'].includes(e.status)).sort((a, b) => a.startAt - b.startAt).slice(0, 10);
    const text = list.map((e) => `**#${e.id}** ${(TYPES[e.type] ?? TYPES.other).emoji} ${e.title} · ${ts(e.startAt, 'f')} (${ts(e.startAt, 'R')}) · ${status[e.status]}`).join('\n') || 'Ближайших ивентов нет.';
    return i.reply(msg(embed('🗓️ Ближайшие ивенты', text), [], { flags: eph })), true;
  }
  if (!hasLevel(i.member, STAFF)) return i.reply({ content: '⛔ Ивенты запускают организаторы и команда сервера.', flags: eph }), true;

  if (sub === 'create') {
    const startAt = parseWhen(i.options.getString('start'));
    if (!startAt) return i.reply({ content: 'Не понял время. Примеры: `2h`, `1d`, `25.12 19:30` (по МСК).', flags: eph }), true;
    if (startAt < Date.now() + 60e3) return i.reply({ content: 'Время старта должно быть в будущем.', flags: eph }), true;
    if (startAt > Date.now() + 60 * 864e5) return i.reply({ content: 'Максимум на 60 дней вперёд.', flags: eph }), true;
    await i.deferReply({ flags: eph });
    const place = i.options.getChannel('place'), img = i.options.getAttachment('image');
    const ev = { id: ++data.eventCounter, title: i.options.getString('title'), type: i.options.getString('type'), description: i.options.getString('description') ?? '',
      prize: i.options.getString('prize') ?? '', prizes: [1, 2, 3].map((n) => i.options.getInteger(`prize${n}`) ?? 0), rulesId: i.options.getChannel('rules')?.id ?? null, coins: i.options.getInteger('coins') ?? 0, limit: i.options.getInteger('limit') ?? 0,
      duration: i.options.getInteger('duration') ?? 120, placeId: place?.id ?? null, where: i.options.getString('where') ?? '',
      hostId: i.user.id, startAt, createdAt: Date.now(), status: 'scheduled', participants: [], hasImage: false, reminded: false };
    let cover;
    if (img && /^image\/(png|jpe?g|webp|gif)/.test(img.contentType ?? '') && img.size <= 8 * 1024 * 1024) {
      cover = Buffer.from(await (await fetch(img.url)).arrayBuffer());
      writeFileSync(imgPath(ev.id), cover); ev.hasImage = true; ev.imageExt = extOf(img.contentType);
    }
    try {
      const base = { name: ev.title.slice(0, 100), scheduledStartTime: new Date(startAt), scheduledEndTime: new Date(startAt + ev.duration * 6e4),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, description: (ev.description || `${(TYPES[ev.type] ?? TYPES.other).name} на сервере TnQko`).slice(0, 1000), image: cover };
      const de = place
        ? await i.guild.scheduledEvents.create({ ...base, entityType: place.type === ChannelType.GuildStageVoice ? ET.StageInstance : ET.Voice, channel: place.id })
        : await i.guild.scheduledEvents.create({ ...base, entityType: ET.External, entityMetadata: { location: (ev.where || 'Сервер TnQko').slice(0, 100) } });
      ev.discordEventId = de.id;
    } catch (e) { console.error('scheduled event', e.message); }
    const ch = await i.client.channels.fetch(cfg.channels.events);
    const pingRole = cfg.roles.eventsPing;
    const sent = await ch.send({ ...post(card(ev), rows(ev), { ping: `<@&${pingRole}> новый ивент!`, allowedMentions: { roles: [pingRole] } }), files: imageFile(ev) });
    ev.messageId = sent.id; data.events[ev.id] = ev; save();
    await sendLog(i.client, embed(`Ивент #${ev.id} создан`, `${ev.title} · ${ts(startAt, 'F')} · организатор ${i.user}`));
    return i.editReply(`✅ Ивент #${ev.id} опубликован в ${ch}. Напоминание и уведомление о старте придут автоматически.`), true;
  }
  const ev = find(i);
  if (!ev) return i.reply({ content: 'Ивент не найден.', flags: eph }), true;
  const owner = ev.hostId === i.user.id || hasLevel(i.member, [cfg.roles.seniorEvent, ...L2]);
  if (!owner) return i.reply({ content: '⛔ Управлять чужим ивентом могут старший ивентер и команда.', flags: eph }), true;
  if (sub === 'start') { if (ev.status !== 'scheduled') return i.reply({ content: 'Ивент уже идёт или завершён.', flags: eph }), true; await startEvent(i.client, ev); }
  else if (sub === 'end') { if (ev.status !== 'live' && ev.status !== 'scheduled') return i.reply({ content: 'Ивент уже завершён.', flags: eph }), true; await endEvent(i.client, ev, false, ['first', 'second', 'third'].map((k) => i.options.getUser(k)?.id).filter(Boolean)); }
  else if (sub === 'cancel') { if (ev.status === 'ended' || ev.status === 'cancelled') return i.reply({ content: 'Ивент уже закрыт.', flags: eph }), true; await cancelEvent(i.client, ev); }
  await i.reply({ content: '✅', flags: eph });
  return true;
}

export async function handleButton(i) {
  const [ns, action, id] = i.customId.split(':');
  if (ns !== 'ev') return false;
  const ev = data.events[id];
  if (!ev || ev.status === 'ended' || ev.status === 'cancelled') return i.reply({ content: 'Этот ивент уже закрыт.', flags: eph }), true;
  const joined = ev.participants.includes(i.user.id);
  if (!joined && ev.limit && ev.participants.length >= ev.limit) return i.reply({ content: 'Мест больше нет.', flags: eph }), true;
  ev.participants = joined ? ev.participants.filter((x) => x !== i.user.id) : [...ev.participants, i.user.id]; save();
  await i.reply({ content: joined ? '👋 Ты больше не участвуешь.' : `🎉 Ты в списке! Напомним о старте ${ts(ev.startAt, 'R')}.`, flags: eph });
  refresh(i.client, ev);
  return true;
}
export { card, rows, imageFile };
