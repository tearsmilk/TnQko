import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { L1, L3 } from './config.js';
import { data, getUser, save } from './store.js';
import { t, hasLevel, embed, sendLog } from './util.js';

const eph = MessageFlags.Ephemeral;
const BANNERS = new URL('../data/banners/', import.meta.url);
mkdirSync(BANNERS, { recursive: true });
const bannerPath = (id) => new URL(`${id}.img`, BANNERS).pathname;
const RENDER = new URL('../render_profile.py', import.meta.url).pathname;
const MAX_BANNER = 8 * 1024 * 1024;

export const commands = [
  new SlashCommandBuilder().setName('profile').setDescription('Карточка профиля')
    .addSubcommand((s) => s.setName('view').setDescription('Показать профиль')
      .addUserOption((o) => o.setName('user').setDescription('Пользователь')))
    .addSubcommand((s) => s.setName('banner').setDescription('Установить баннер')
      .addAttachmentOption((o) => o.setName('image').setDescription('PNG, JPG, WEBP или GIF до 8 МБ').setRequired(true)))
    .addSubcommand((s) => s.setName('banner-reset').setDescription('Убрать баннер')
      .addUserOption((o) => o.setName('user').setDescription('Только для стаффа'))),
  new SlashCommandBuilder().setName('daily').setDescription('Ежедневная награда'),
  new SlashCommandBuilder().setName('economy').setDescription('Для стаффа: изменить баланс')
    .addSubcommand((s) => s.setName('give').setDescription('Выдать или забрать валюту')
      .addUserOption((o) => o.setName('user').setDescription('Пользователь').setRequired(true))
      .addStringOption((o) => o.setName('currency').setDescription('Валюта').setRequired(true).addChoices({ name: 'монеты', value: 'coins' }, { name: 'кристаллы', value: 'crystals' }))
      .addIntegerOption((o) => o.setName('amount').setDescription('Можно отрицательное').setMinValue(-1000000).setMaxValue(1000000).setRequired(true))),
].map((c) => c.setContexts(0).toJSON());

const nameCache = new Map();
export async function displayName(client, id) {
  if (nameCache.has(id)) return nameCache.get(id);
  const u = await client.users.fetch(id).catch(() => null);
  const n = u ? (u.globalName ?? u.username) : 'unknown';
  nameCache.set(id, n); setTimeout(() => nameCache.delete(id), 6e5);
  return n;
}

function render(payload) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.PYTHON || 'python3', [RENDER]);
    const out = [], err = [];
    const timer = setTimeout(() => { p.kill(); reject(new Error('render timeout')); }, 20000);
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => err.push(c));
    p.on('error', reject);
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString())); });
    p.stdin.end(JSON.stringify(payload));
  });
}

export async function profileImage(client, user, member) {
  const u = getUser(user.id);
  const av = await fetch(user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }));
  const avatar = Buffer.from(await av.arrayBuffer()).toString('base64');
  const clan = u.clanId ? data.clans[u.clanId] : null;
  const pair = u.pair ? { name: await displayName(client, u.pair.id), days: Math.max(1, Math.floor((Date.now() - u.pair.since) / 864e5) + 1) } : null;
  const png = await render({
    name: member?.displayName ?? user.globalName ?? user.username, avatar,
    banner: u.banner && existsSync(bannerPath(user.id)) ? bannerPath(user.id) : null,
    coins: u.coins, crystals: u.crystals, voice: u.voice, messages: u.messages,
    pair, clan: clan ? { name: clan.name, members: clan.members.length } : null,
  });
  return new AttachmentBuilder(png, { name: 'profile.png' });
}

export async function handleCommand(i) {
  const name = i.commandName;
  if (name === 'profile') {
    const sub = i.options.getSubcommand();
    if (sub === 'view') {
      await i.deferReply();
      const user = i.options.getUser('user') ?? i.user;
      if (user.bot) return i.editReply(t(i, 'У ботов нет профиля.', 'Bots have no profile.')), true;
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      await i.editReply({ files: [await profileImage(i.client, user, member)] });
    } else if (sub === 'banner') {
      const a = i.options.getAttachment('image');
      if (!/^image\/(png|jpe?g|webp|gif)/.test(a.contentType ?? '')) return i.reply({ content: t(i, 'Нужна картинка PNG, JPG, WEBP или GIF.', 'PNG, JPG, WEBP or GIF image required.'), flags: eph }), true;
      if (a.size > MAX_BANNER) return i.reply({ content: t(i, 'Максимум 8 МБ.', 'Max 8 MB.'), flags: eph }), true;
      await i.deferReply({ flags: eph });
      writeFileSync(bannerPath(i.user.id), Buffer.from(await (await fetch(a.url)).arrayBuffer()));
      getUser(i.user.id).banner = true; save();
      await i.editReply({ content: t(i, '✅ Баннер установлен. Помни: правила сервера (без NSFW) действуют и здесь.', '✅ Banner set. Server rules (no NSFW) apply here too.'),
        files: [await profileImage(i.client, i.user, i.member)] });
    } else if (sub === 'banner-reset') {
      const target = i.options.getUser('user') ?? i.user;
      if (target.id !== i.user.id && !hasLevel(i.member, L1)) return i.reply({ content: t(i, '⛔ Только стафф может сбрасывать чужие баннеры.', '⛔ Only staff can reset others\' banners.'), flags: eph }), true;
      if (existsSync(bannerPath(target.id))) unlinkSync(bannerPath(target.id));
      getUser(target.id).banner = false; save();
      if (target.id !== i.user.id) await sendLog(i.client, embed('Сброс баннера', `${i.user} сбросил(а) баннер ${target}`));
      await i.reply({ content: '✅', flags: eph });
    }
    return true;
  }
  if (name === 'daily') {
    const u = getUser(i.user.id), now = Date.now();
    if (now - u.lastDaily < 20 * 36e5) {
      const left = Math.ceil((20 * 36e5 - (now - u.lastDaily)) / 6e4);
      return i.reply({ content: t(i, `⏳ Следующая награда через ${Math.floor(left / 60)} ч ${left % 60} м.`, `⏳ Next reward in ${Math.floor(left / 60)}h ${left % 60}m.`), flags: eph }), true;
    }
    u.streak = now - u.lastDaily > 48 * 36e5 ? 1 : u.streak + 1;
    u.lastDaily = now;
    const coins = 100 + Math.min(u.streak, 7) * 10;
    u.coins += coins;   // /daily даёт только обычные монеты
    save();
    await i.reply({ content: `🎁 Ты получил **${coins}** 🪙. Серия: **${u.streak}** дн.` });
    return true;
  }
  if (name === 'economy') {
    if (!hasLevel(i.member, L3)) return i.reply({ content: '⛔', flags: eph }), true;
    const user = i.options.getUser('user'), cur = i.options.getString('currency'), amt = i.options.getInteger('amount');
    const u = getUser(user.id);
    if (u[cur] + amt < 0) return i.reply({ content: t(i, 'Баланс не может быть отрицательным.', 'Balance cannot go negative.'), flags: eph }), true;
    u[cur] += amt; save();
    await sendLog(i.client, embed('Экономика', `${i.user} → ${user}: **${amt > 0 ? '+' : ''}${amt}** ${cur === 'coins' ? 'монет' : 'кристаллов'} (теперь ${u[cur]})`));
    await i.reply({ content: `✅ ${user}: ${u[cur]} ${cur}`, flags: eph });
    return true;
  }
  return false;
}
