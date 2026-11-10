import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { cfg, L2 } from './config.js';
import { data, getUser, save } from './store.js';
import { embed, msg, post, activity, t, hasLevel, parseDuration, sendLog } from './util.js';

const eph = MessageFlags.Ephemeral;
export const commands = [new SlashCommandBuilder().setName('giveaway').setDescription('Розыгрыши (для стаффа)')
  .addSubcommand((s) => s.setName('start').setDescription('Начать розыгрыш')
    .addStringOption((o) => o.setName('prize').setDescription('Приз').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('duration').setDescription('Срок: 10m, 2h, 1d (максимум 28d)').setRequired(true))
    .addIntegerOption((o) => o.setName('winners').setDescription('1-10').setMinValue(1).setMaxValue(10))
    .addIntegerOption((o) => o.setName('coins').setDescription('Автонаграда монетами каждому победителю').setMinValue(1).setMaxValue(100000)))
  .addSubcommand((s) => s.setName('end').setDescription('Завершить сейчас')
    .addIntegerOption((o) => o.setName('id').setDescription('ID розыгрыша').setRequired(true)))
  .setContexts(0).toJSON()];

const view = (g, ended) => {
  const bullets = ended
    ? [g.winnerIds.length ? `**Победители:** ${g.winnerIds.map((x) => `<@${x}>`).join(', ')}` : 'Участников не было']
    : [`**Конец:** <t:${Math.floor(g.endsAt / 1000)}:R>`, `**Победителей:** ${g.winners}`, 'Нажми кнопку ниже, чтобы участвовать'];
  const rewards = g.coins ? [`**Награда:** ${g.coins} 🪙`] : [];
  return activity({ title: `🎁 Розыгрыш — ${g.prize}`, subtitle: ended ? '✅ Завершён' : '🔴 Идёт сейчас', bullets, rewards, footer: `Розыгрыш #${g.id}`, color: ended ? 0x7a7a85 : undefined });
};
const joinRow = (g, off = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`gw:join:${g.id}`).setLabel('Участвовать').setEmoji('🎉').setStyle(ButtonStyle.Primary).setDisabled(off));

async function finish(client, g) {
  if (g.ended) return;
  g.ended = true;
  const pool = [...g.entrants];
  g.winnerIds = [];
  while (pool.length && g.winnerIds.length < g.winners) g.winnerIds.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  for (const id of g.winnerIds) { const u = getUser(id); u.coins += g.coins || 0; }
  save();
  try {
    const ch = await client.channels.fetch(g.channelId);
    await ch.messages.edit(g.messageId, post(view(g, true), [joinRow(g, true)], { allowedMentions: { parse: [] } }));
    await ch.send({ content: g.winnerIds.length ? `🎉 ${g.winnerIds.map((x) => `<@${x}>`).join(', ')} — **${g.prize}**!` : `🎉 **${g.prize}**: нет участников`,
      reply: { messageReference: g.messageId, failIfNotExists: false }, allowedMentions: { users: g.winnerIds } });
  } catch (e) { console.error('giveaway finish', e.message); }
  await sendLog(client, embed(`Розыгрыш #${g.id} завершён`, `${g.prize} · победители: ${g.winnerIds.map((x) => `<@${x}>`).join(', ') || '—'}`));
}
export const startGiveawayTimer = (client) => setInterval(() => {
  for (const g of Object.values(data.giveaways)) if (!g.ended && Date.now() >= g.endsAt) finish(client, g);
}, 20e3);

export async function handleCommand(i) {
  if (i.commandName !== 'giveaway') return false;
  if (!hasLevel(i.member, L2)) return i.reply({ content: '⛔', flags: eph }), true;
  if (i.options.getSubcommand() === 'end') {
    const g = data.giveaways[i.options.getInteger('id')];
    if (!g || g.ended) return i.reply({ content: 'Не найден.', flags: eph }), true;
    await finish(i.client, g); return i.reply({ content: '✅', flags: eph }), true;
  }
  const ms = parseDuration(i.options.getString('duration'));
  if (!ms) return i.reply({ content: 'Формат: 10m, 2h, 1d (максимум 28d).', flags: eph }), true;
  const id = ++data.giveawayCounter;
  const g = { id, prize: i.options.getString('prize'), endsAt: Date.now() + ms, winners: i.options.getInteger('winners') ?? 1,
    coins: i.options.getInteger('coins') ?? 0, entrants: [], ended: false, hostId: i.user.id, winnerIds: [] };
  const ch = await i.client.channels.fetch(cfg.channels.events);
  const m = await ch.send(post(view(g, false), [joinRow(g)]));
  Object.assign(g, { channelId: ch.id, messageId: m.id }); data.giveaways[id] = g; save();
  await i.reply({ content: `✅ Розыгрыш #${id} опубликован в ${ch}`, flags: eph });
  return true;
}

export async function handleButton(i) {
  const [ns, action, id] = i.customId.split(':');
  if (ns !== 'gw') return false;
  const g = data.giveaways[id];
  if (!g || g.ended) return i.reply({ content: t(i, 'Розыгрыш завершён.', 'This giveaway has ended.'), flags: eph }), true;
  const joined = g.entrants.includes(i.user.id);
  g.entrants = joined ? g.entrants.filter((x) => x !== i.user.id) : [...g.entrants, i.user.id]; save();
  await i.reply({ content: joined ? t(i, '👋 Ты вышел из розыгрыша.', '👋 You left the giveaway.') : t(i, `🎉 Ты участвуешь! Участников: ${g.entrants.length}`, `🎉 You are in! Entrants: ${g.entrants.length}`), flags: eph });
  return true;
}
