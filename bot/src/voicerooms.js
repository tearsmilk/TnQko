// Приватные войсы: заходишь в канал-«создатель», бот создаёт личную комнату и переносит тебя туда.
// Управление комнатой через панель кнопок в текстовом канале настройки.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits as P,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from 'discord.js';
import { cfg } from './config.js';
import { data, save } from './store.js';
import { embed, msg } from './util.js';

const eph = MessageFlags.Ephemeral;
const cooldown = new Map();
const NAME_RE = /^[\p{L}\p{N}\p{Extended_Pictographic}‍️ _.,!?+&()-]{1,30}$/u;

const owner = [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.MoveMembers];
const ownerPerms = { ViewChannel: true, Connect: true, Speak: true, Stream: true, MoveMembers: true };
const isRoom = (id) => Boolean(data.rooms?.[id]);
const row = (...b) => new ActionRowBuilder().addComponents(...b);
const btn = (id, label, emoji, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`vr:${id}`).setLabel(label).setEmoji(emoji).setStyle(style);

export const panelRows = () => [
  row(btn('rename', 'Название', '✏️'), btn('limit', 'Лимит', '👥'), btn('lock', 'Закрыть / открыть', '🔒'), btn('hide', 'Скрыть / показать', '👁️')),
  row(btn('invite', 'Пригласить', '➕'), btn('kick', 'Выгнать', '🚫'), btn('transfer', 'Передать', '👑'), btn('delete', 'Удалить', '🗑️', ButtonStyle.Danger)),
];
export const panelMessage = () => msg(embed('🎧 Приватные войсы',
  `Зайди в канал <#${cfg.channels.voiceHub}>: бот создаст личную комнату и перенесёт тебя в неё.\n` +
  'Когда в комнате никого не останется, она удалится сама.\n\n' +
  '**Управление** (находясь в своей комнате):\n' +
  '✏️ изменить название · 👥 лимит участников · 🔒 закрыть вход · 👁️ скрыть комнату\n' +
  '➕ пригласить · 🚫 выгнать · 👑 передать комнату · 🗑️ удалить'), panelRows());

async function create(state) {
  const { guild, member } = state;
  const existing = Object.entries(data.rooms).find(([, r]) => r.ownerId === member.id);
  if (existing) { const ch = guild.channels.cache.get(existing[0]); if (ch) return member.voice.setChannel(ch).catch(() => {}); delete data.rooms[existing[0]]; }
  if (Date.now() - (cooldown.get(member.id) ?? 0) < 10000) return;
  cooldown.set(member.id, Date.now());
  const name = `🎧│${member.displayName}`.slice(0, 30);
  const ch = await guild.channels.create({
    name, type: ChannelType.GuildVoice, parent: cfg.channels.voiceCategory,
    permissionOverwrites: [{ id: member.id, allow: owner }], reason: `Приватный войс для ${member.user.tag}`,
  });
  data.rooms[ch.id] = { ownerId: member.id, createdAt: Date.now() }; save();
  await member.voice.setChannel(ch).catch(async () => { await ch.delete().catch(() => {}); delete data.rooms[ch.id]; save(); });
}

async function drop(channel) {
  delete data.rooms[channel.id]; save();
  await channel.delete('Приватный войс опустел').catch(() => {});
}

export async function onVoice(oldS, newS) {
  try {
    if (newS.channelId === cfg.channels.voiceHub && newS.member && !newS.member.user.bot) await create(newS);
    const old = oldS.channel;
    if (old && isRoom(old.id) && oldS.channelId !== newS.channelId) {
      const humans = old.members.filter((m) => !m.user.bot);
      if (!humans.size) return drop(old);
      const room = data.rooms[old.id];
      if (room.ownerId === oldS.id) {            // владелец вышел: комната переходит к другому участнику
        const next = humans.first();
        await old.permissionOverwrites.edit(next.id, ownerPerms);
        room.ownerId = next.id; save();
      }
    }
  } catch (e) { console.error('voicerooms', e.message); }
}

export async function cleanup(client) {
  for (const id of Object.keys(data.rooms)) {
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch) { delete data.rooms[id]; continue; }
    if (!ch.members.filter((m) => !m.user.bot).size) await drop(ch);
  }
  save();
}

function myRoom(i) {
  const ch = i.member?.voice?.channel;
  if (!ch || !isRoom(ch.id)) return { error: 'Зайди в свою приватную комнату, чтобы управлять ею.' };
  if (data.rooms[ch.id].ownerId !== i.user.id) return { error: 'Это не твоя комната.' };
  return { ch };
}
const userSelect = (id, ph) => row(new UserSelectMenuBuilder().setCustomId(`vr:${id}`).setPlaceholder(ph).setMinValues(1).setMaxValues(1));

export async function handle(i) {
  if (!i.customId?.startsWith('vr:')) return false;
  const action = i.customId.slice(3);
  const { ch, error } = myRoom(i);
  if (error) return i.reply({ content: `⛔ ${error}`, flags: eph }), true;
  const everyone = i.guild.roles.everyone;

  if (i.isButton()) {
    if (action === 'rename') {
      await i.showModal(new ModalBuilder().setCustomId('vr:renamesubmit').setTitle('Название комнаты').addComponents(
        row(new TextInputBuilder().setCustomId('name').setLabel('Новое название (до 30 символов)').setStyle(TextInputStyle.Short).setMaxLength(30).setRequired(true))));
    } else if (action === 'limit') {
      await i.showModal(new ModalBuilder().setCustomId('vr:limitsubmit').setTitle('Лимит участников').addComponents(
        row(new TextInputBuilder().setCustomId('n').setLabel('Число от 0 до 99 (0 — без лимита)').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true))));
    } else if (action === 'lock') {
      const locked = ch.permissionsFor(everyone).has(P.Connect);
      await ch.permissionOverwrites.edit(everyone, { Connect: locked ? false : null });
      await i.reply({ content: locked ? '🔒 Комната закрыта: войти могут только приглашённые.' : '🔓 Комната открыта.', flags: eph });
    } else if (action === 'hide') {
      const visible = ch.permissionsFor(everyone).has(P.ViewChannel);
      await ch.permissionOverwrites.edit(everyone, { ViewChannel: visible ? false : null });
      await i.reply({ content: visible ? '👁️ Комната скрыта от остальных.' : '👁️ Комната снова видна.', flags: eph });
    } else if (action === 'invite') await i.reply({ components: [userSelect('invitesel', 'Кого пригласить?')], flags: eph });
    else if (action === 'kick') await i.reply({ components: [userSelect('kicksel', 'Кого выгнать?')], flags: eph });
    else if (action === 'transfer') await i.reply({ components: [userSelect('xfersel', 'Кому передать комнату?')], flags: eph });
    else if (action === 'delete') {
      await i.reply({ content: 'Удалить комнату?', flags: eph, components: [row(btn('deleteyes', 'Да, удалить', '🗑️', ButtonStyle.Danger))] });
    } else if (action === 'deleteyes') {
      await i.update({ content: '🗑️ Комната удаляется.', components: [] });
      await drop(ch);
    }
    return true;
  }
  if (i.isModalSubmit()) {
    if (action === 'renamesubmit') {
      const name = i.fields.getTextInputValue('name').trim();
      if (!NAME_RE.test(name)) return i.reply({ content: '⛔ Допустимы буквы, цифры, эмодзи и простые знаки.', flags: eph }), true;
      await ch.setName(`🎧│${name}`.slice(0, 100)).catch(() => {});
      await i.reply({ content: '✅ Название изменено (Discord ограничивает смену имени: не чаще двух раз за 10 минут).', flags: eph });
    } else if (action === 'limitsubmit') {
      const n = Number(i.fields.getTextInputValue('n'));
      if (!Number.isInteger(n) || n < 0 || n > 99) return i.reply({ content: '⛔ Введи число от 0 до 99.', flags: eph }), true;
      await ch.setUserLimit(n);
      await i.reply({ content: n ? `✅ Лимит: ${n}.` : '✅ Лимит снят.', flags: eph });
    }
    return true;
  }
  if (i.isUserSelectMenu()) {
    const target = i.users.first(), member = i.members?.first();
    if (!target || target.bot || target.id === i.user.id) return i.update({ content: '⛔ Выбери другого человека.', components: [] }), true;
    if (action === 'invitesel') {
      await ch.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true });
      await i.update({ content: `✅ ${target} приглашён(а).`, components: [] });
    } else if (action === 'kicksel') {
      await ch.permissionOverwrites.edit(target.id, { Connect: false });
      if (member?.voice?.channelId === ch.id) await member.voice.disconnect().catch(() => {});
      await i.update({ content: `🚫 ${target} выгнан(а) и не сможет вернуться.`, components: [] });
    } else if (action === 'xfersel') {
      await ch.permissionOverwrites.edit(target.id, ownerPerms);
      await ch.permissionOverwrites.delete(i.user.id).catch(() => {});
      data.rooms[ch.id].ownerId = target.id; save();
      await i.update({ content: `👑 Комната передана ${target}.`, components: [] });
    }
    return true;
  }
  return false;
}
