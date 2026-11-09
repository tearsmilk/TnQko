// Публикует панели тикетов и заявок (Components V2). Запуск один раз: npm run panels
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
  { type: 1, components: Object.entries(TYPES).map(([k, v]) => btn(`tk:open:${k}`, v.ru, v.emoji)) });

const apps = box(
  T('# 📝 Заявки в команду\nХочешь стать частью команды? Выбери направление, заполни анкету, и решение придёт в личные сообщения.\n' +
    Object.values(APP_TYPES).map((a) => `**${a.ru}** — от ${a.minAge} лет`).join('\n') + '\nПовторная заявка после отказа возможна через 14 дней.'),
  SEP,
  { type: 1, components: Object.entries(APP_TYPES).map(([k, a]) => btn(`ap:open:${k}`, a.ru, a.emoji)) });

const only = process.argv[2];
for (const [name, ch, body] of [['tickets', cfg.channels.panelTickets, tickets], ['apps', cfg.channels.panelApps, apps]]) {
  if (only && only !== name) continue;
  const m = await rest.post(Routes.channelMessages(ch), { body });
  console.log('опубликовано', name, m.id);
}
