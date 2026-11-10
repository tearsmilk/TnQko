// Казино (монеты) и крутки (gacha): коллекционные роли за монеты.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { cfg } from './config.js';
import { getUser, save } from './store.js';
import { embed, msg, sendLog } from './util.js';

const eph = MessageFlags.Ephemeral;
const MIN_BET = 10, MAX_BET = 500, MAX_WIN = 50000, COOLDOWN = 4000;
const PULL = 160, PULL10 = 1600; // цена в кристаллах 💎, как 160 примогемов за крутку в Genshin
const GUAR = { C: 20, R: 40, E: 80 }; // гарантии: обычная роль / редкая / эпическая или легендарная
const GREEN = 0x6fa380, RED = 0xa05a5a, GREY = 0x7a7a85;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cd = new Map();
const rnd = (n) => Math.floor(Math.random() * n);

export const commands = [
  new SlashCommandBuilder().setName('casino').setDescription('Казино за монеты')
    .addSubcommand((s) => s.setName('coinflip').setDescription('Орёл или решка (выигрыш x2)')
      .addIntegerOption((o) => o.setName('bet').setDescription(`Ставка ${MIN_BET}-${MAX_BET}`).setMinValue(MIN_BET).setMaxValue(MAX_BET).setRequired(true))
      .addStringOption((o) => o.setName('side').setDescription('Сторона').setRequired(true).addChoices({ name: 'орёл', value: 'heads' }, { name: 'решка', value: 'tails' })))
    .addSubcommand((s) => s.setName('slots').setDescription('Слоты')
      .addIntegerOption((o) => o.setName('bet').setDescription(`Ставка ${MIN_BET}-${MAX_BET}`).setMinValue(MIN_BET).setMaxValue(MAX_BET).setRequired(true)))
    .addSubcommand((s) => s.setName('roulette').setDescription('Рулетка: красное/чёрное x2, зелёное x36')
      .addIntegerOption((o) => o.setName('bet').setDescription(`Ставка ${MIN_BET}-${MAX_BET}`).setMinValue(MIN_BET).setMaxValue(MAX_BET).setRequired(true))
      .addStringOption((o) => o.setName('color').setDescription('Цвет').setRequired(true).addChoices({ name: '🔴 красное', value: 'red' }, { name: '⚫ чёрное', value: 'black' }, { name: '🟢 зелёное (0)', value: 'green' }))),
  new SlashCommandBuilder().setName('gacha').setDescription('Крутки: коллекционные роли')
    .addSubcommand((s) => s.setName('pull').setDescription(`Одна крутка (${PULL} кристаллов)`))
    .addSubcommand((s) => s.setName('multi').setDescription(`10 круток (${PULL10} кристаллов)`))
    .addSubcommand((s) => s.setName('collection').setDescription('Твоя коллекция ролей').addUserOption((o) => o.setName('user').setDescription('Чья коллекция')))
    .addSubcommand((s) => s.setName('rates').setDescription('Шансы, гарантии и список ролей')),
].map((c) => c.setContexts(0).toJSON());

// ---------- слоты ----------
const REELS = [['🍒', 30], ['🍋', 25], ['🍇', 20], ['🔔', 12], ['💎', 8], ['7️⃣', 5]];
const TRIPLE = { '7️⃣': 200, '💎': 60, '🔔': 30, '🍇': 15, '🍋': 10, '🍒': 6 };
function spinReel() { let r = rnd(100); for (const [s, w] of REELS) { if ((r -= w) < 0) return s; } return '🍒'; }
function slotsPayout(r) {
  const [a, b, c] = r;
  if (a === b && b === c) return TRIPLE[a];
  const pair = a === b || a === c || b === c;
  const sym = a === b || a === c ? a : b;
  if (pair && sym === '🍒') return 1.5;
  if (pair && (sym === '🍋' || sym === '🍇')) return 0.5;
  return 0;
}
// ---------- рулетка ----------
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
const COLOR_EMOJI = { red: '🔴', black: '⚫', green: '🟢' };

function result(i, title, line, net, bet) {
  const c = net > 0 ? GREEN : net < 0 ? RED : GREY;
  const text = net > 0 ? `**+${net} 🪙** (выигрыш)` : net < 0 ? `**${net} 🪙** (проигрыш)` : 'Ставка возвращена';
  return msg(embed(title, `${line}\n\n${text}`).setColor(c).setFooter({ text: `Баланс: ${getUser(i.user.id).coins} 🪙 · ставка ${bet}` }));
}

async function casino(i) {
  const sub = i.options.getSubcommand(), bet = i.options.getInteger('bet'), u = getUser(i.user.id);
  const last = cd.get(i.user.id) ?? 0;
  if (Date.now() - last < COOLDOWN) return i.reply({ content: '⏳ Не так быстро, подожди пару секунд.', flags: eph });
  if (u.coins < bet) return i.reply({ content: `Не хватает монет: у тебя ${u.coins} 🪙.`, flags: eph });
  cd.set(i.user.id, Date.now());
  u.coins -= bet; save();
  let win = 0;
  if (sub === 'coinflip') {
    const side = i.options.getString('side');
    // небольшой перекос в пользу казино: шанс выигрыша 49%
    const won = Math.random() < 0.49, shown = won ? side : side === 'heads' ? 'tails' : 'heads';
    win = won ? bet * 2 : 0;
    u.coins += win; save();
    return i.reply(result(i, '🪙 Орёл или решка', `Выпало: **${shown === 'heads' ? 'орёл' : 'решка'}** (ты ставил на ${side === 'heads' ? 'орла' : 'решку'})`, win - bet, bet));
  }
  if (sub === 'roulette') {
    const color = i.options.getString('color'), n = rnd(37), got = colorOf(n);
    win = got === color ? bet * (color === 'green' ? 36 : 2) : 0;
    win = Math.min(win, MAX_WIN); u.coins += win; save();
    return i.reply(result(i, '🎡 Рулетка', `Выпало **${n}** ${COLOR_EMOJI[got]} (твоя ставка: ${COLOR_EMOJI[color]})`, win - bet, bet));
  }
  // slots: анимация в три шага
  const reels = [spinReel(), spinReel(), spinReel()];
  const view = (a, b, c, tail) => msg(embed('🎰 Слоты', `## ${a} ┃ ${b} ┃ ${c}${tail ? `\n\n${tail}` : ''}`).setColor(GREY));
  await i.reply(view('❔', '❔', '❔'));
  await sleep(700); await i.editReply(view(reels[0], '❔', '❔'));
  await sleep(700); await i.editReply(view(reels[0], reels[1], '❔'));
  await sleep(700);
  const mult = slotsPayout(reels);
  win = Math.min(Math.floor(bet * mult), MAX_WIN); u.coins += win; save();
  const line = `## ${reels.join(' ┃ ')}`;
  await i.editReply(result(i, '🎰 Слоты', line, win - bet, bet));
  if (win >= 10000) sendLog(i.client, embed('Крупный выигрыш в слотах', `${i.user}: **+${win - bet} 🪙** (x${mult}, ставка ${bet})`));
  return true;
}

// ---------- крутки ----------
const POOL = (cfg.gachaRoles ?? []);
const byRarity = (r) => POOL.filter((x) => x.rarity === r);
const RAR = {
  N: { e: '⚫', name: 'Без роли', color: GREY }, C: { e: '⚪', name: 'Обычная', color: 0xb8c4d6 }, R: { e: '🔵', name: 'Редкая', color: 0x5b8bd6 },
  E: { e: '🟣', name: 'Эпическая', color: 0x8e5bff }, L: { e: '🟡', name: 'Легендарная', color: 0xffd166 },
};
const ORDER = { N: 0, C: 1, R: 2, E: 3, L: 4 };
const DUP = { C: 100, R: 300, E: 800, L: 2000 };      // монеты, если такая роль уже есть
const RATES = { L: 0.5, E: 2, R: 4.5, C: 8 };          // шанс в %, остальное (85%) — роль не выпала
const NO_ROLE = 100 - Object.values(RATES).reduce((a, b) => a + b, 0);

function pullOnce(u) {
  u.pulls = (u.pulls ?? 0) + 1; u.collection ??= [];
  u.pityC = (u.pityC ?? 0) + 1; u.pityR = (u.pityR ?? 0) + 1; u.pityE = (u.pityE ?? 0) + 1;
  let r = Math.random() * 100, rar = 'N';
  for (const k of ['L', 'E', 'R', 'C']) { if ((r -= RATES[k]) < 0) { rar = k; break; } }
  // гарантии (по счётчику круток без подходящей роли)
  if (u.pityE >= GUAR.E && ORDER[rar] < 3) rar = Math.random() < 0.2 ? 'L' : 'E';
  else if (u.pityR >= GUAR.R && ORDER[rar] < 2) rar = 'R';
  else if (u.pityC >= GUAR.C && ORDER[rar] < 1) rar = 'C';
  if (rar === 'L' || rar === 'E') u.pityE = u.pityR = u.pityC = 0;
  else if (rar === 'R') u.pityR = u.pityC = 0;
  else if (rar === 'C') u.pityC = 0;
  if (rar === 'N') { const c = 150 + rnd(251); u.coins += c; return { rar, text: `роль не выпала: **+${c}** 🪙` }; } // кристаллы из круток не выпадают
  const list = byRarity(rar), role = list[rnd(list.length)];
  if (u.collection.includes(role.key)) { u.coins += DUP[rar]; return { rar, role, dup: true, text: `<@&${role.roleId}> (повтор, +${DUP[rar]} 🪙)` }; }
  u.collection.push(role.key);
  return { rar, role, text: `<@&${role.roleId}> ✨ **новая роль!**` };
}
async function syncRoles(i, member, u) {
  const need = (u.collection ?? []).map((k) => POOL.find((x) => x.key === k)?.roleId).filter((id) => id && !member.roles.cache.has(id));
  if (need.length) await member.roles.add(need, 'Крутки: коллекция').catch((e) => console.error('gacha roles', e.message));
}
const left = (u) => `до обычной: ${Math.max(0, GUAR.C - (u.pityC ?? 0))} · до редкой: ${Math.max(0, GUAR.R - (u.pityR ?? 0))} · до эпика: ${Math.max(0, GUAR.E - (u.pityE ?? 0))}`;
async function gacha(i) {
  const sub = i.options.getSubcommand();
  const u = getUser(i.user.id); u.collection ??= []; u.pulls ??= 0; u.pityC ??= 0; u.pityR ??= 0; u.pityE ??= 0;
  if (sub === 'rates') {
    const list = (r) => byRarity(r).map((x) => `<@&${x.roleId}>`).join(' ');
    return i.reply(msg(embed('🎲 Крутки', `Цена: **${PULL} 💎** за крутку, **${PULL10} 💎** за 10.\nКристаллы выдаёт администрация, а ещё их дают за места в топе недели.`).addFields(
      { name: `🟡 Легендарная · ${RATES.L}%`, value: list('L') },
      { name: `🟣 Эпическая · ${RATES.E}%`, value: list('E') },
      { name: `🔵 Редкая · ${RATES.R}%`, value: list('R') },
      { name: `⚪ Обычная · ${RATES.C}%`, value: list('C') },
      { name: `⚫ Роль не выпала · ${NO_ROLE}%`, value: 'Падают монеты: от 150 до 400 🪙. Кристаллы из круток не выпадают.' },
      { name: 'Гарантии', value: `• каждые **${GUAR.C}** круток минимум обычная роль\n• каждые **${GUAR.R}** круток минимум редкая\n• каждые **${GUAR.E}** круток эпическая или легендарная\nБолее высокая роль сбрасывает и низшие счётчики.` },
      { name: 'Повторы', value: `Роль уже есть: обычная +${DUP.C}, редкая +${DUP.R}, эпическая +${DUP.E}, легендарная +${DUP.L} 🪙` }), [], { flags: eph }));
  }
  if (sub === 'collection') {
    const target = i.options.getUser('user') ?? i.user, tu = getUser(target.id); tu.collection ??= [];
    if (target.id === i.user.id) { const m = await i.guild.members.fetch(i.user.id).catch(() => null); if (m) await syncRoles(i, m, tu); }
    const owned = ['L', 'E', 'R', 'C'].map((r) => { const items = byRarity(r).filter((x) => tu.collection.includes(x.key)); return `${RAR[r].e} **${RAR[r].name}:** ${items.length ? items.map((x) => `<@&${x.roleId}>`).join(' ') : '—'}`; }).join('\n');
    return i.reply(msg(embed(`🎴 Коллекция · ${target.globalName ?? target.username}`, owned).setFooter({ text: `Собрано ${tu.collection.length}/${POOL.length} · круток: ${tu.pulls ?? 0} · ${left(tu)}` }), [], { allowedMentions: { parse: [] } }));
  }
  const n = sub === 'multi' ? 10 : 1, cost = n === 10 ? PULL10 : PULL;
  const last = cd.get(i.user.id) ?? 0;
  if (Date.now() - last < COOLDOWN) return i.reply({ content: '⏳ Не так быстро, подожди пару секунд.', flags: eph });
  if (u.crystals < cost) return i.reply({ content: `Нужно ${cost} 💎, у тебя ${u.crystals} 💎. Кристаллы выдаёт администрация или дают за места в топе недели.`, flags: eph });
  cd.set(i.user.id, Date.now());
  u.crystals -= cost;
  const res = [];
  for (let k = 0; k < n; k++) res.push(pullOnce(u));
  save();
  const member = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (member) await syncRoles(i, member, u);
  const best = res.reduce((a, b) => (ORDER[b.rar] > ORDER[a.rar] ? b : a));
  const lines = res.map((r) => `${RAR[r.rar].e} ${r.text}`).join('\n');
  await i.reply(msg(embed(n === 10 ? '🎲 10 круток' : '🎲 Крутка', lines).setColor(RAR[best.rar].color)
    .setFooter({ text: `Баланс: ${u.coins} 🪙 · ${u.crystals} 💎 · ${left(u)}` }), [], { allowedMentions: { parse: [] } }));
  const top = res.filter((r) => r.rar === 'L' || r.rar === 'E');
  if (top.some((r) => r.rar === 'L')) sendLog(i.client, embed('Легендарная крутка', `${i.user} выбил(а) ${top.filter((r) => r.rar === 'L').map((r) => `<@&${r.role.roleId}>`).join(' ')}`));
  return true;
}

export async function handleCommand(i) {
  if (i.commandName === 'casino') { await casino(i); return true; }
  if (i.commandName === 'gacha') { await gacha(i); return true; }
  return false;
}

export const _test = { slotsPayout, spinReel, pullOnce, colorOf };
