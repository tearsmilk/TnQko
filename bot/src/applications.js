import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { cfg, L2 } from './config.js';
import { data, save } from './store.js';
import { t, hasLevel, embed, msg, sendLog } from './util.js';

const eph = MessageFlags.Ephemeral;
export const APP_TYPES = {
  mod: { ru: 'Модератор', en: 'Moderator', emoji: '🛡️', role: cfg.roles.mod, minAge: 16 },
  media: { ru: 'Медиа', en: 'Media', emoji: '🎬', role: cfg.roles.media, minAge: 13 },
  forumCreative: { ru: 'Менеджер форумов: Творчество', en: 'Forum manager: Creative', emoji: '🎨', role: cfg.roles.forumCreative, minAge: 16 },
  forumPortal: { ru: 'Менеджер форумов: Портал', en: 'Forum manager: Portal', emoji: '💻', role: cfg.roles.forumPortal, minAge: 16 },
};
const COOLDOWN = 14 * 864e5;
const input = (id, label, style, req = true, max = 1000) =>
  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(req).setMaxLength(max));

function modal(i, type) {
  const A = APP_TYPES[type];
  return new ModalBuilder().setCustomId(`ap:submit:${type}`).setTitle(`${t(i, 'Заявка', 'Application')}: ${t(i, A.ru, A.en)}`.slice(0, 45)).addComponents(
    input('age', t(i, 'Возраст', 'Age'), TextInputStyle.Short, true, 3),
    input('tz', t(i, 'Часовой пояс / страна', 'Timezone / country'), TextInputStyle.Short, true, 40),
    input('exp', t(i, 'Опыт', 'Experience'), TextInputStyle.Paragraph, true, 800),
    input('why', t(i, 'Почему ты хочешь в команду?', 'Why do you want to join?'), TextInputStyle.Paragraph, true, 800),
    input('links', t(i, 'Ссылки на работы (необязательно)', 'Links to your work (optional)'), TextInputStyle.Short, false, 300));
}

const reviewRow = (id) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`ap:accept:${id}`).setLabel('Принять').setEmoji('✅').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`ap:decline:${id}`).setLabel('Отклонить').setEmoji('❌').setStyle(ButtonStyle.Danger));
const appCard = (a) => embed(`📝 Заявка: ${APP_TYPES[a.type].ru} #${a.id}`, null).setThumbnail(a.avatar).addFields(
  { name: 'Заявитель', value: `<@${a.userId}> (${a.userId})` }, { name: 'Возраст · часовой пояс', value: `${a.age} · ${a.tz}` },
  { name: 'Опыт', value: a.exp }, { name: 'Мотивация', value: a.why }, { name: 'Ссылки', value: a.links });

async function submit(i, type) {
  const A = APP_TYPES[type];
  const age = parseInt(i.fields.getTextInputValue('age'), 10);
  if (!Number.isInteger(age) || age < 13 || age > 99) return i.reply({ content: t(i, 'Укажи возраст числом.', 'Enter your age as a number.'), flags: eph });
  if (age < A.minAge) return i.reply({ content: t(i, `Минимальный возраст: ${A.minAge}.`, `Minimum age: ${A.minAge}.`), flags: eph });
  const mine = Object.values(data.apps).filter((a) => a.userId === i.user.id && a.type === type);
  if (mine.some((a) => a.status === 'pending')) return i.reply({ content: t(i, 'У тебя уже есть заявка на рассмотрении.', 'You already have a pending application.'), flags: eph });
  if (mine.some((a) => a.status === 'declined' && Date.now() - a.decidedAt < COOLDOWN)) return i.reply({ content: t(i, 'Повторная заявка возможна через 14 дней после отказа.', 'You can re-apply 14 days after a decline.'), flags: eph });
  if (i.member.roles.cache.has(A.role)) return i.reply({ content: t(i, 'У тебя уже есть эта роль.', 'You already have this role.'), flags: eph });
  const id = ++data.appCounter;
  const f = (k) => i.fields.getTextInputValue(k) || '—';
  const app = { id, userId: i.user.id, type, status: 'pending', at: Date.now(), avatar: i.user.displayAvatarURL(), tag: i.user.tag,
    age, tz: f('tz'), exp: f('exp'), why: f('why'), links: f('links') };
  const sent = await (await i.client.channels.fetch(cfg.channels.appReview)).send(msg(appCard(app), [reviewRow(id)]));
  data.apps[id] = { ...app, messageId: sent.id }; save();
  await i.reply({ content: t(i, '✅ Заявка отправлена. Мы сообщим о решении в личные сообщения.', '✅ Application sent. We will DM you with the decision.'), flags: eph });
}

async function decide(i, id, accepted, reason) {
  const app = data.apps[id];
  if (!app || app.status !== 'pending') return i.reply({ content: 'Уже обработано.', flags: eph });
  app.status = accepted ? 'accepted' : 'declined'; app.decidedAt = Date.now(); app.by = i.user.id; save();
  const A = APP_TYPES[app.type];
  const user = await i.client.users.fetch(app.userId);
  if (accepted) { const m = await i.guild.members.fetch(app.userId).catch(() => null); await m?.roles.add(A.role, `Application #${id}`).catch(() => {}); }
  await user.send(msg(embed(accepted ? '✅ Заявка принята' : '❌ Заявка отклонена',
    `**${A.ru}**${reason ? `\n**Причина:** ${reason}` : ''}`))).catch(() => {});
  const card = appCard(app).setColor(accepted ? 0x6fa380 : 0xa05a5a).setFooter({ text: `${accepted ? 'Принято' : 'Отклонено'}: ${i.user.tag}${reason ? ` — ${reason}` : ''}` });
  const patch = msg(card);
  await (i.isModalSubmit() ? i.message.edit(patch) : i.update(patch));
  if (i.isModalSubmit()) await i.reply({ content: '👌', flags: eph });
  await sendLog(i.client, embed(`Заявка #${id}: ${app.status === 'accepted' ? 'принята' : 'отклонена'}`, `<@${app.userId}> · ${A.ru} · решил(а) ${i}${reason ? `\n${reason}` : ''}`));
}

export async function handleApp(i) {
  const [ns, action, arg] = i.customId.split(':');
  if (ns !== 'ap') return false;
  if (i.isButton() && action === 'open') { await i.showModal(modal(i, arg)); return true; }
  if (i.isModalSubmit() && action === 'submit') { await submit(i, arg); return true; }
  if (!hasLevel(i.member, L2)) { await i.reply({ content: '⛔', flags: eph }); return true; }
  if (i.isButton() && action === 'accept') await decide(i, arg, true);
  else if (i.isButton() && action === 'decline')
    await i.showModal(new ModalBuilder().setCustomId(`ap:reason:${arg}`).setTitle('Отклонить').addComponents(input('reason', 'Причина', TextInputStyle.Paragraph, false, 400)));
  else if (i.isModalSubmit() && action === 'reason') await decide(i, arg, false, i.fields.getTextInputValue('reason') || null);
  return true;
}
