import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { L1, L2, L3 } from './config.js';
import { data, save } from './store.js';
import { t, hasLevel, embed, sendLog, parseDuration, fmtDur } from './util.js';

const eph = MessageFlags.Ephemeral;
const reasonOpt = (o) => o.setName('reason').setDescription('Reason / Причина').setMaxLength(500);
const userOpt = (o) => o.setName('user').setDescription('User / Пользователь').setRequired(true);

export const commands = [
  new SlashCommandBuilder().setName('warn').setDescription('Warn a user / Выдать предупреждение')
    .addUserOption(userOpt).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName('mute').setDescription('Timeout a user / Замутить')
    .addUserOption(userOpt)
    .addStringOption((o) => o.setName('duration').setDescription('10m, 2h, 1d, 1w (max 28d)').setRequired(true))
    .addStringOption(reasonOpt),
  new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout / Снять мут').addUserOption(userOpt),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a user / Кикнуть').addUserOption(userOpt).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a user / Забанить').addUserOption(userOpt).addStringOption(reasonOpt)
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete messages for N days / Удалить сообщения за N дней').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('unban').setDescription('Unban by user ID / Разбан по ID')
    .addStringOption((o) => o.setName('user_id').setDescription('User ID').setRequired(true)).addStringOption(reasonOpt),
  new SlashCommandBuilder().setName('purge').setDescription('Delete messages / Удалить сообщения')
    .addIntegerOption((o) => o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((o) => o.setName('user').setDescription('Only this user / Только этого пользователя')),
  new SlashCommandBuilder().setName('history').setDescription('Moderation history / История наказаний').addUserOption(userOpt),
].map((c) => c.setContexts(0).toJSON());

const REQ = { warn: L1, mute: L1, unmute: L1, purge: L1, history: L1, kick: L2, ban: L3, unban: L3 };

function addCase(type, user, mod, reason, duration) {
  const c = { id: ++data.caseCounter, type, userId: user.id, modId: mod.id, reason: reason || '—', duration: duration || null, at: Date.now() };
  data.cases.push(c); save(); return c;
}
async function logCase(client, c, user, mod) {
  const e = embed(`Case #${c.id} · ${c.type.toUpperCase()}`)
    .addFields({ name: 'User', value: `${user} (${user.id})`, inline: true }, { name: 'Moderator', value: `${mod}`, inline: true },
      { name: 'Reason', value: c.reason });
  if (c.duration) e.addFields({ name: 'Duration', value: fmtDur(c.duration), inline: true });
  await sendLog(client, e);
}
const dm = (user, title, c, server) => user.send({ embeds: [embed(title, `**Reason / Причина:** ${c.reason}`).setFooter({ text: server })] }).catch(() => {});
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
    await i.reply({ embeds: [embed(`History · ${user.tag}`, lines || t(i, 'Чисто.', 'Clean record.')).setFooter({ text: `Active warns: ${activeWarns(user.id)}` })], flags: eph });
    return true;
  }
  if (name === 'purge') {
    await i.deferReply({ flags: eph });
    let msgs = await i.channel.messages.fetch({ limit: 100 });
    if (user) msgs = msgs.filter((m) => m.author.id === user.id);
    const del = await i.channel.bulkDelete([...msgs.values()].slice(0, i.options.getInteger('amount')), true);
    await sendLog(i.client, embed('PURGE', `${i.user} deleted **${del.size}** messages in ${i.channel}${user ? ` from ${user}` : ''}.`));
    await i.editReply(t(i, `🧹 Удалено: ${del.size}`, `🧹 Deleted: ${del.size}`));
    return true;
  }
  if (name === 'unban') {
    const id = i.options.getString('user_id').trim();
    try { await i.guild.bans.remove(id, reason ?? undefined); } catch { await i.reply({ content: t(i, 'Бан не найден.', 'Ban not found.'), flags: eph }); return true; }
    const c = addCase('unban', { id }, i.user, reason);
    await logCase(i.client, c, { id, toString: () => `<@${id}>` }, i.user);
    await i.reply({ content: `✅ Case #${c.id}`, flags: eph });
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
      await dm(user, '⚠️ Warning / Предупреждение', c, guildName);
      await logCase(i.client, c, user, i.user);
      const n = activeWarns(user.id);
      let extra = '';
      if (n >= 3 && member.moderatable) {
        await member.timeout(36e5, 'Auto: 3 warnings');
        const a = addCase('mute', user, i.client.user, 'Auto: 3 warnings in 30 days', 36e5);
        await logCase(i.client, a, user, i.client.user); extra = t(i, ' · авто-мут 1ч', ' · auto-mute 1h');
      }
      await i.reply({ content: `⚠️ Case #${c.id} · warns: ${n}${extra}`, flags: eph });
    } else if (name === 'mute') {
      const ms = parseDuration(i.options.getString('duration'));
      if (!ms) { await i.reply({ content: t(i, 'Формат: 10m, 2h, 1d, 1w (до 28d).', 'Format: 10m, 2h, 1d, 1w (max 28d).'), flags: eph }); return true; }
      await member.timeout(ms, reason ?? undefined);
      const c = addCase('mute', user, i.user, reason, ms);
      await dm(user, `🔇 Mute · ${fmtDur(ms)}`, c, guildName); await logCase(i.client, c, user, i.user);
      await i.reply({ content: `🔇 Case #${c.id}`, flags: eph });
    } else if (name === 'unmute') {
      await member.timeout(null);
      const c = addCase('unmute', user, i.user); await logCase(i.client, c, user, i.user);
      await i.reply({ content: `🔊 Case #${c.id}`, flags: eph });
    } else if (name === 'kick') {
      const c = addCase('kick', user, i.user, reason);
      await dm(user, '👢 Kick', c, guildName); await member.kick(reason ?? undefined); await logCase(i.client, c, user, i.user);
      await i.reply({ content: `👢 Case #${c.id}`, flags: eph });
    } else if (name === 'ban') {
      const c = addCase('ban', user, i.user, reason);
      await dm(user, '🔨 Ban', c, guildName);
      await i.guild.bans.create(user.id, { reason: reason ?? undefined, deleteMessageSeconds: (i.options.getInteger('delete_days') ?? 0) * 86400 });
      await logCase(i.client, c, user, i.user);
      await i.reply({ content: `🔨 Case #${c.id}`, flags: eph });
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
  if (arr.length >= 7) { reason = 'Spam'; mute = 5 * 6e4; spam.delete(m.author.id); }
  else if (m.mentions.users.size + m.mentions.roles.size >= 5 || m.mentions.everyone) { reason = 'Mass mentions'; mute = 10 * 6e4; }
  else if (m.content && INVITE.test(m.content)) reason = 'Invite link';
  if (!reason) return;
  await m.delete().catch(() => {});
  const c = addCase(mute ? 'mute' : 'warn', m.author, m.client.user, `Automod: ${reason}`, mute || null);
  if (mute && m.member.moderatable) await m.member.timeout(mute, `Automod: ${reason}`).catch(() => {});
  await logCase(m.client, c, m.author, m.client.user);
  m.channel.send({ content: `${m.author}, ⚠️ ${reason}` }).then((x) => setTimeout(() => x.delete().catch(() => {}), 6000)).catch(() => {});
}
