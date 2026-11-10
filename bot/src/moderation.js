import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { L1, L2, L3 } from './config.js';
import { data, save } from './store.js';
import { t, hasLevel, embed, msg, sendLog, parseDuration, fmtDur } from './util.js';

const eph = MessageFlags.Ephemeral;
const reasonOpt = (o) => o.setName('reason').setDescription('Причина').setMaxLength(500);
const userOpt = (o) => o.setName('user').setDescription('Пользователь').setRequired(true);

export const commands = [
  new SlashCommandBuilder().setName('warn').setDescription('Выдать предупреждение')
    .addUserOption(userOpt).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName('mute').setDescription('Замутить')
    .addUserOption(userOpt)
    .addStringOption((o) => o.setName('duration').setDescription('10m, 2h, 1d, 1w (max 28d)').setRequired(true))
    .addStringOption(reasonOpt),
  new SlashCommandBuilder().setName('unmute').setDescription('Снять мут').addUserOption(userOpt),
  new SlashCommandBuilder().setName('kick').setDescription('Кикнуть').addUserOption(userOpt).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName('ban').setDescription('Забанить').addUserOption(userOpt).addStringOption(reasonOpt)
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Удалить сообщения за N дней').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('unban').setDescription('Разбан по ID')
    .addStringOption((o) => o.setName('user_id').setDescription('ID пользователя').setRequired(true)).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName('purge').setDescription('Удалить сообщения')
    .addIntegerOption((o) => o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((o) => o.setName('user').setDescription('Только этого пользователя')),
  new SlashCommandBuilder().setName('history').setDescription('История наказаний').addUserOption(userOpt),
].map((c) => c.setContexts(0).toJSON());

const TYPE_RU = { warn: 'ПРЕДУПРЕЖДЕНИЕ', mute: 'МУТ', unmute: 'СНЯТИЕ МУТА', kick: 'КИК', ban: 'БАН', unban: 'РАЗБАН' };
const REQ = { warn: L1, mute: L1, unmute: L1, purge: L1, history: L1, kick: L2, ban: L3, unban: L3 };

function addCase(type, user, mod, reason, duration) {
  const c = { id: ++data.caseCounter, type, userId: user.id, modId: mod.id, reason: reason || '—', duration: duration || null, at: Date.now() };
  data.cases.push(c); save(); return c;
}
async function logCase(client, c, user, mod) {
  const e = embed(`Кейс #${c.id} · ${TYPE_RU[c.type] ?? c.type}`)
    .addFields({ name: 'Пользователь', value: `${user} (${user.id})` }, { name: 'Модератор', value: `${mod}` },
      { name: 'Причина', value: c.reason });
  if (c.duration) e.addFields({ name: 'Срок', value: fmtDur(c.duration) });
  await sendLog(client, e);
}
const dm = (user, title, c, server) => user.send(msg(embed(title, `**Причина:** ${c.reason}`).setFooter({ text: server }))).catch(() => {});
const activeWarns = (id) => data.cases.filter((c) => c.type === 'warn' && c.userId === id && Date.now() - c.at < 30 * 864e5).length;

export async function handleCommand(i) {
  const name = i.commandName;
  if (!REQ[name]) return false;
  if (!hasLevel(i.member, REQ[name])) {
    await i.reply({ content: t(i, '⛔ Недостаточно прав.', '⛔ You do not have permission.'), flags: eph });
    return true;
  }
  const user = i.options.getUser('user');
  const reason = i.options.getString('reason');
  const guildName = i.guild.name;

  if (name === 'history') {
    const list = data.cases.filter((c) => c.userId === user.id).slice(-15).reverse();
    const lines = list.map((c) => `**#${c.id}** ${c.type} · <t:${Math.floor(c.at / 1000)}:d> · <@${c.modId}> · ${c.reason}`).join('\n');
    await i.reply(msg(embed(`История · ${user.tag}`, lines || 'Чисто.').setFooter({ text: `Активных предупреждений: ${activeWarns(user.id)}` }), [], { flags: eph }));
    return true;
  }
  if (name === 'purge') {
    await i.deferReply({ flags: eph });
    let msgs = await i.channel.messages.fetch({ limit: 100 });
    if (user) msgs = msgs.filter((m) => m.author.id === user.id);
    const del = await i.channel.bulkDelete([...msgs.values()].slice(0, i.options.getInteger('amount')), true);
    await sendLog(i.client, embed('Очистка', `${i.user} удалил(а) **${del.size}** сообщений в ${i.channel}${user ? ` от ${user}` : ''}.`));
    await i.editReply(t(i, `🧹 Удалено: ${del.size}`, `🧹 Deleted: ${del.size}`));
    return true;
  }
  if (name === 'unban') {
    const id = i.options.getString('user_id').trim();
    try { await i.guild.bans.remove(id, reason ?? undefined); } catch { await i.reply({ content: t(i, 'Бан не найден.', 'Ban not found.'), flags: eph }); return true; }
    const c = addCase('unban', { id }, i.user, reason);
    await logCase(i.client, c, { id, toString: () => `<@${id}>` }, i.user);
    await i.reply({ content: `✅ Кейс #${c.id}`, flags: eph });
    return true;
  }

  const member = await i.guild.members.fetch(user.id).catch(() => null);
  if (!member && name !== 'ban') { await i.reply({ content: t(i, 'Пользователь не на сервере.', 'User is not in the server.'), flags: eph }); return true; }
  if (member) {
    const owner = i.guild.ownerId === i.user.id;
    if (user.id === i.user.id || user.id === i.client.user.id || (!owner && member.roles.highest.position >= i.member.roles.highest.position)) {
      await i.reply({ content: t(i, '⛔ Нельзя применить к этому пользователю.', '⛔ You cannot act on this user.'), flags: eph }); return true;
    }
  }
  try {
    if (name === 'warn') {
      const c = addCase('warn', user, i.user, reason);
      await dm(user, '⚠️ Предупреждение', c, guildName);
      await logCase(i.client, c, user, i.user);
      const n = activeWarns(user.id);
      let extra = '';
      if (n >= 3 && member.moderatable) {
        await member.timeout(36e5, 'Авто: 3 предупреждения');
        const a = addCase('mute', user, i.client.user, 'Авто: 3 предупреждения за 30 дней', 36e5);
        await logCase(i.client, a, user, i.client.user); extra = t(i, ' · авто-мут 1ч', ' · auto-mute 1h');
      }
      await i.reply({ content: `⚠️ Кейс #${c.id} · предупреждений: ${n}${extra}`, flags: eph });
    } else if (name === 'mute') {
      const ms = parseDuration(i.options.getString('duration'));
      if (!ms) { await i.reply({ content: t(i, 'Формат: 10m, 2h, 1d, 1w (до 28d).', 'Format: 10m, 2h, 1d, 1w (max 28d).'), flags: eph }); return true; }
      await member.timeout(ms, reason ?? undefined);
      const c = addCase('mute', user, i.user, reason, ms);
      await dm(user, `🔇 Mute · ${fmtDur(ms)}`, c, guildName); await logCase(i.client, c, user, i.user);
      await i.reply({ content: `🔇 Кейс #${c.id}`, flags: eph });
    } else if (name === 'unmute') {
      await member.timeout(null);
      const c = addCase('unmute', user, i.user); await logCase(i.client, c, user, i.user);
      await i.reply({ content: `🔊 Кейс #${c.id}`, flags: eph });
    } else if (name === 'kick') {
      const c = addCase('kick', user, i.user, reason);
      await dm(user, '👢 Kick', c, guildName); await member.kick(reason ?? undefined); await logCase(i.client, c, user, i.user);
      await i.reply({ content: `👢 Кейс #${c.id}`, flags: eph });
    } else if (name === 'ban') {
      const c = addCase('ban', user, i.user, reason);
      await dm(user, '🔨 Ban', c, guildName);
      await i.guild.bans.create(user.id, { reason: reason ?? undefined, deleteMessageSeconds: (i.options.getInteger('delete_days') ?? 0) * 86400 });
      await logCase(i.client, c, user, i.user);
      await i.reply({ content: `🔨 Кейс #${c.id}`, flags: eph });
    }
  } catch (err) {
    console.error(err);
    await (i.replied || i.deferred ? i.editReply : i.reply).call(i, { content: t(i, '❌ Не удалось выполнить (проверь права и иерархию ролей бота).', '❌ Failed (check bot permissions and role hierarchy).'), flags: eph });
  }
  return true;
}

// ---------- Light automod ----------
const spam = new Map();
const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/\w+/i;
export async function automod(m) {
  if (m.author.bot || !m.guild || !m.member || hasLevel(m.member, L1)) return;
  let reason = null, mute = 0;
  const now = Date.now();
  const arr = (spam.get(m.author.id) ?? []).filter((x) => now - x < 5000); arr.push(now); spam.set(m.author.id, arr);
  if (arr.length >= 7) { reason = 'Спам'; mute = 5 * 6e4; spam.delete(m.author.id); }
  else if (m.mentions.users.size + m.mentions.roles.size >= 5 || m.mentions.everyone) { reason = 'Массовые упоминания'; mute = 10 * 6e4; }
  else if (m.content && INVITE.test(m.content)) reason = 'Ссылка-приглашение';
  if (!reason) return;
  await m.delete().catch(() => {});
  const c = addCase(mute ? 'mute' : 'warn', m.author, m.client.user, `Автомод: ${reason}`, mute || null);
  if (mute && m.member.moderatable) await m.member.timeout(mute, `Автомод: ${reason}`).catch(() => {});
  await logCase(m.client, c, m.author, m.client.user);
  m.channel.send({ content: `${m.author}, ⚠️ ${reason}` }).then((x) => setTimeout(() => x.delete().catch(() => {}), 6000)).catch(() => {});
}
