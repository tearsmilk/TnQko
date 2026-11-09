// Posts the ticket & application panels (Components V2). Run once: npm run panels
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { cfg } from './config.js';
import { TYPES } from './tickets.js';
import { APP_TYPES } from './applications.js';

const rest = new REST().setToken(process.env.BOT_TOKEN);
const T = (content) => ({ type: 10, content });
const SEP = { type: 14, divider: true, spacing: 1 };
const btn = (id, label, emoji) => ({ type: 2, style: 2, custom_id: id, label, emoji: { name: emoji } });
const box = (...c) => ({ flags: 32768, components: [{ type: 17, accent_color: cfg.color, components: c }] });

const tickets = box(
  T('# 🎫 Поддержка и обращения\nНужна помощь, хочешь пожаловаться или предложить сотрудничество? Выбери тип обращения, и мы откроем приватный канал.'),
  SEP,
  T('# 🎫 Support & tickets\nNeed help, want to report something or propose a collaboration? Pick a ticket type and we will open a private channel.'),
  SEP,
  { type: 1, components: Object.entries(TYPES).map(([k, v]) => btn(`tk:open:${k}`, `${v.ru} / ${v.en}`, v.emoji)) });

const apps = box(
  T('# 📝 Заявки в команду\nХочешь стать частью команды? Подай заявку и расскажи о себе. Решение придёт в личные сообщения.\n**Модератор** — от 16 лет. **Медиа** — от 13 лет.\nПовторная заявка после отказа возможна через 14 дней.'),
  SEP,
  T('# 📝 Team applications\nWant to join the team? Send an application and tell us about yourself. The decision comes by DM.\n**Moderator** — 16+. **Media** — 13+.\nYou can re-apply 14 days after a decline.'),
  SEP,
  { type: 1, components: [btn('ap:open:mod', 'Модератор / Moderator', '🛡️'), btn('ap:open:media', 'Медиа / Media', '🎬')] });

for (const [ch, body] of [[cfg.channels.panelTickets, tickets], [cfg.channels.panelApps, apps]]) {
  const m = await rest.post(Routes.channelMessages(ch), { body });
  console.log('posted', ch, m.id);
}
