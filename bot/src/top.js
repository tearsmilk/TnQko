import { SlashCommandBuilder } from 'discord.js';
import { cfg } from './config.js';
import { data, getUser, save, nextMonday } from './store.js';
import { embed, msg, t } from './util.js';

export const commands = [new SlashCommandBuilder().setName('top').setDescription('Топ участников')
  .addStringOption((o) => o.setName('category').setDescription('Что показать').setRequired(true).addChoices(
    { name: 'сообщения', value: 'messages' }, { name: 'войс', value: 'voice' },
    { name: 'монеты', value: 'coins' }, { name: 'кристаллы', value: 'crystals' }))
  .addStringOption((o) => o.setName('period').setDescription('Период').addChoices({ name: 'всё время', value: 'all' }, { name: 'неделя', value: 'week' }))
  .setContexts(0).toJSON()];

const NAMES = { messages: 'сообщения', voice: 'войс', coins: 'монеты', crystals: 'кристаллы' };
const medal = (n) => ['🥇', '🥈', '🥉'][n] ?? `**${n + 1}.**`;
const hours = (s) => `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
const fmt = { messages: (v) => `${v} msg`, voice: hours, coins: (v) => `${v} 🪙`, crystals: (v) => `${v} 💎` };

function rank(category, period) {
  if (period === 'week') {
    const f = category === 'voice' ? 'v' : 'm';
    return Object.entries(data.week?.users ?? {}).map(([id, w]) => [id, w[f]]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }
  return Object.entries(data.users).map(([id, u]) => [id, u[category]]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}
const lines = (list, category) => list.slice(0, 10).map(([id, v], n) => `${medal(n)} <@${id}> · ${fmt[category](v)}`).join('\n') || '—';

export async function handleCommand(i) {
  if (i.commandName !== 'top') return false;
  const category = i.options.getString('category'), period = i.options.getString('period') ?? 'all';
  if (period === 'week' && !['messages', 'voice'].includes(category)) return i.reply({ content: t(i, 'За неделю доступны только сообщения и войс.', 'Weekly top supports only messages and voice.'), flags: 64 }), true;
  await i.reply(msg(embed(`🏆 Топ · ${NAMES[category]}${period === 'week' ? ' · неделя' : ''}`, lines(rank(category, period), category)), [], { allowedMentions: { parse: [] } }));
  return true;
}

const REWARDS = [300, 200, 100], GEMS = [160, 80, 40];
export async function weeklyJob(client) {
  data.week ??= { next: nextMonday(), users: {} };
  if (Date.now() < data.week.next) return;
  const byMsg = rank('messages', 'week'), voice = rank('voice', 'week');
  for (const list of [byMsg, voice]) list.slice(0, 3).forEach(([id], n) => { const u = getUser(id); u.coins += REWARDS[n]; u.crystals += GEMS[n]; });
  const e = embed('🏆 Топ недели', 'Награда в каждой категории: 🥇 300 🪙 + 160 💎 · 🥈 200 🪙 + 80 💎 · 🥉 100 🪙 + 40 💎')
    .addFields({ name: '💬 Сообщения', value: lines(byMsg, 'messages') }, { name: '🎧 Войс', value: lines(voice, 'voice') });
  data.week = { next: nextMonday(), users: {} }; save();
  try { await (await client.channels.fetch(cfg.channels.weeklyTop)).send(msg(e, [], { allowedMentions: { parse: [] } })); } catch (err) { console.error('weekly top', err.message); }
}
export const startWeekly = (client) => { weeklyJob(client); setInterval(() => weeklyJob(client), 10 * 6e4); };
