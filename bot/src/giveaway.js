import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { cfg, L2 } from './config.js';
import { data, getUser, save } from './store.js';
import { embed, t, hasLevel, parseDuration, sendLog } from './util.js';

const eph = MessageFlags.Ephemeral;
export const commands = [new SlashCommandBuilder().setName('giveaway').setDescription('Giveaways / Розыгрыши (staff)')
  .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway / Начать розыгрыш')
    .addStringOption((o) => o.setName('prize').setDescription('Prize / Приз').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('duration').setDescription('10m, 2h, 1d (max 28d)').setRequired(true))
    .addIntegerOption((o) => o.setName('winners').setDescription('1-10').setMinValue(1).setMaxValue(10))
    .addIntegerOption((o) => o.setName('coins').setDescription('Auto-reward coins per winner').setMinValue(1).setMaxValue(100000))
    .addIntegerOption((o) => o.setName('crystals').setDescription('Auto-reward crystals per winner').setMinValue(1).setMaxValue(1000)))
  .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now / Завершить сейчас')
    .addIntegerOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
  .setContexts(0).toJSON()];

const view = (g, ended) => embed(`🎉 ${g.prize}`, ended
  ? (g.winnerIds.length ? `**Winners / Победители:** ${g.winnerIds.map((x) => `<@${x}>`).join(', ')}` : 'No participants / Нет участников')
  : `Нажми кнопку, чтобы участвовать / Press the button to join\n**Ends / Конец:** <t:${Math.floor(g.endsAt / 1000)}:R>\n**Winners / Победителей:** ${g.winners}`)
  .setFooter({ text: `ID ${g.id}${g.coins ? ` · +${g.coins} coins` : ''}${g.crystals ? ` · +${g.crystals} crystals` : ''}` });
const joinRow = (g, off = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`gw:join:${g.id}`).setLabel('Join / Участвовать').setEmoji('🎉').setStyle(ButtonStyle.Primary).setDisabled(off));

async function finish(client, g) {
  if (g.ended) return;
  g.ended = true;
  const pool = [...g.entrants];
  g.winnerIds = [];
  while (pool.length && g.winnerIds.length < g.winners) g.winnerIds.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  for (const id of g.winnerIds) { const u = getUser(id); u.coins += g.coins || 0; u.crystals += g.crystals || 0; }
  save();
  try {
    const ch = await client.channels.fetch(g.channelId);
    await ch.messages.edit(g.messageId, { embeds: [view(g, true)], components: [joinRow(g, true)], allowedMentions: { parse: [] } });
    await ch.send({ content: g.winnerIds.length ? `🎉 ${g.winnerIds.map((x) => `<@${x}>`).join(', ')} — **${g.prize}**!` : `🎉 **${g.prize}**: нет участников / no participants`,
      reply: { messageReference: g.messageId, failIfNotExists: false }, allowedMentions: { users: g.winnerIds } });
  } catch (e) { console.error('giveaway finish', e.message); }
  await sendLog(client, embed(`Giveaway #${g.id} ended`, `${g.prize} · winners: ${g.winnerIds.map((x) => `<@${x}>`).join(', ') || '—'}`));
}
export const startGiveawayTimer = (client) => setInterval(() => {
  for (const g of Object.values(data.giveaways)) if (!g.ended && Date.now() >= g.endsAt) finish(client, g);
}, 20e3);

export async function handleCommand(i) {
  if (i.commandName !== 'giveaway') return false;
  if (!hasLevel(i.member, L2)) return i.reply({ content: '⛔', flags: eph }), true;
  if (i.options.getSubcommand() === 'end') {
    const g = data.giveaways[i.options.getInteger('id')];
    if (!g || g.ended) return i.reply({ content: 'Not found / Не найден.', flags: eph }), true;
    await finish(i.client, g); return i.reply({ content: '✅', flags: eph }), true;
  }
  const ms = parseDuration(i.options.getString('duration'));
  if (!ms) return i.reply({ content: 'Format: 10m, 2h, 1d (max 28d).', flags: eph }), true;
  const id = ++data.giveawayCounter;
  const g = { id, prize: i.options.getString('prize'), endsAt: Date.now() + ms, winners: i.options.getInteger('winners') ?? 1,
    coins: i.options.getInteger('coins') ?? 0, crystals: i.options.getInteger('crystals') ?? 0, entrants: [], ended: false, hostId: i.user.id, winnerIds: [] };
  const ch = await i.client.channels.fetch(cfg.channels.events);
  const m = await ch.send({ embeds: [view(g, false)], components: [joinRow(g)] });
  Object.assign(g, { channelId: ch.id, messageId: m.id }); data.giveaways[id] = g; save();
  await i.reply({ content: `✅ Giveaway #${id} → ${ch}`, flags: eph });
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
