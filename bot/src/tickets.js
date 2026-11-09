import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits as P, AttachmentBuilder, MessageFlags } from 'discord.js';
import { cfg, L1, LEADERS } from './config.js';
import { data, save } from './store.js';
import { t, hasLevel, embed, sendLog } from './util.js';

const eph = MessageFlags.Ephemeral;
export const TYPES = {
  question: { emoji: '❓', ru: 'Вопрос', en: 'Question', staff: L1 },
  report: { emoji: '🚨', ru: 'Жалоба', en: 'Report', staff: L1 },
  partnership: { emoji: '🤝', ru: 'Партнёрство', en: 'Partnership', staff: LEADERS },
  collab: { emoji: '🎬', ru: 'Сотрудничество', en: 'Collaboration', staff: LEADERS },
};
const MAX_OPEN = 2;
const IDLE_MS = 48 * 36e5;
const row = (...b) => new ActionRowBuilder().addComponents(...b);
const controls = (i) => row(
  new ButtonBuilder().setCustomId('tk:claim').setLabel(t(i, 'Взять', 'Claim')).setEmoji('🙋').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('tk:close').setLabel(t(i, 'Закрыть', 'Close')).setEmoji('🔒').setStyle(ButtonStyle.Danger));

async function open(i, type) {
  const T = TYPES[type];
  if (!T) return;
  const mine = Object.values(data.tickets).filter((x) => x.userId === i.user.id);
  if (mine.length >= MAX_OPEN) return i.reply({ content: t(i, `У тебя уже ${mine.length} открытых тикета: <#${mine[0].channelId}>`, `You already have ${mine.length} open tickets: <#${mine[0].channelId}>`), flags: eph });
  await i.deferReply({ flags: eph });
  const n = ++data.ticketCounter;
  const name = `${type}-${String(n).padStart(4, '0')}`;
  const allow = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
  const channel = await i.guild.channels.create({
    name, type: ChannelType.GuildText, parent: cfg.channels.ticketsCategory,
    topic: `${T.en} · ${i.user.tag} (${i.user.id})`,
    permissionOverwrites: [
      { id: i.guild.id, deny: [P.ViewChannel] },
      { id: i.user.id, allow },
      { id: i.client.user.id, allow: [...allow, P.ManageChannels] },
      ...T.staff.map((id) => ({ id, allow })),
    ],
  });
  data.tickets[channel.id] = { id: n, channelId: channel.id, userId: i.user.id, type, claimedBy: null, last: Date.now(), openedAt: Date.now() };
  save();
  await channel.send({
    content: `${i.user} ${T.staff.map((r) => `<@&${r}>`).join(' ')}`,
    allowedMentions: { users: [i.user.id], roles: T.staff.slice(0, 1) },
    embeds: [embed(`${T.emoji} ${T.ru} / ${T.en} · #${n}`,
      'Опиши ситуацию подробно, команда ответит как можно скорее.\nDescribe your situation in detail, the team will reply as soon as possible.')],
    components: [controls(i)],
  });
  await sendLog(i.client, embed(`Ticket #${n} opened`, `${i.user} · ${T.en} · ${channel}`));
  await i.editReply(t(i, `✅ Тикет создан: ${channel}`, `✅ Ticket created: ${channel}`));
}

async function claim(i, tk) {
  if (!hasLevel(i.member, TYPES[tk.type].staff)) return i.reply({ content: t(i, '⛔ Только команда.', '⛔ Staff only.'), flags: eph });
  if (tk.claimedBy) return i.reply({ content: t(i, `Уже взял <@${tk.claimedBy}>.`, `Already claimed by <@${tk.claimedBy}>.`), flags: eph });
  tk.claimedBy = i.user.id; save();
  await i.reply({ content: t(i, `🙋 Тикет взял ${i.user}`, `🙋 Ticket claimed by ${i.user}`) });
}

async function close(i, tk, reason = 'closed') {
  const ch = i.channel ?? await i.client.channels.fetch(tk.channelId);
  const lines = [];
  let before;
  for (let k = 0; k < 10; k++) {
    const batch = await ch.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    lines.unshift(...[...batch.values()].reverse().map((m) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}${m.attachments.size ? ' ' + m.attachments.map((a) => a.url).join(' ') : ''}`));
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  const file = new AttachmentBuilder(Buffer.from(lines.join('\n') || '(empty)', 'utf8'), { name: `ticket-${tk.id}.txt` });
  await sendLog(i.client, embed(`Ticket #${tk.id} closed`, `Owner: <@${tk.userId}> · Type: ${tk.type} · Claimed: ${tk.claimedBy ? `<@${tk.claimedBy}>` : '—'}\nReason: ${reason}`), [file]);
  delete data.tickets[tk.channelId]; save();
  await ch.delete(`Ticket closed: ${reason}`).catch(() => {});
}

export async function handleButton(i) {
  const [ns, action, arg] = i.customId.split(':');
  if (ns !== 'tk') return false;
  if (action === 'open') { await open(i, arg); return true; }
  const tk = data.tickets[i.channelId];
  if (!tk) { await i.reply({ content: '—', flags: eph }); return true; }
  if (action === 'claim') await claim(i, tk);
  else if (action === 'close') {
    const ok = i.user.id === tk.userId || hasLevel(i.member, TYPES[tk.type].staff);
    if (!ok) return i.reply({ content: t(i, '⛔ Нет доступа.', '⛔ No access.'), flags: eph }), true;
    await i.reply({ content: t(i, 'Закрыть тикет? Канал будет удалён, транскрипт сохранится в логах.', 'Close the ticket? The channel will be deleted, the transcript is saved to logs.'),
      components: [row(new ButtonBuilder().setCustomId('tk:confirm').setLabel(t(i, 'Да, закрыть', 'Yes, close')).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tk:cancel').setLabel(t(i, 'Отмена', 'Cancel')).setStyle(ButtonStyle.Secondary))], flags: eph });
  } else if (action === 'cancel') await i.update({ content: '👌', components: [] });
  else if (action === 'confirm') {
    const ok = i.user.id === tk.userId || hasLevel(i.member, TYPES[tk.type].staff);
    if (!ok) return i.reply({ content: '⛔', flags: eph }), true;
    await i.update({ content: '🔒', components: [] });
    await close(i, tk, `by ${i.user.tag}`);
  }
  return true;
}

export function touch(m) {
  const tk = data.tickets[m.channelId];
  if (tk && !m.author.bot) { tk.last = Date.now(); save(); }
}
export function startIdleCloser(client) {
  setInterval(async () => {
    for (const tk of Object.values(data.tickets)) {
      if (Date.now() - tk.last < IDLE_MS) continue;
      try { const ch = await client.channels.fetch(tk.channelId); await close({ client, channel: ch }, tk, 'inactive 48h'); }
      catch { delete data.tickets[tk.channelId]; save(); }
    }
  }, 15 * 6e4);
}
