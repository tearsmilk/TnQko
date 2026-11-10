import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
const dir = new URL('../data/', import.meta.url);
const file = new URL('../data/db.json', import.meta.url);
mkdirSync(dir, { recursive: true });
const def = { caseCounter: 0, cases: [], ticketCounter: 0, tickets: {}, appCounter: 0, apps: {}, users: {}, clans: {}, clanCounter: 0, week: null, giveaways: {}, giveawayCounter: 0, rooms: {}, events: {}, eventCounter: 0 };
let db = existsSync(file) ? { ...def, ...JSON.parse(readFileSync(file, 'utf8')) } : structuredClone(def);
let timer = null;
export const data = db;
export function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const tmp = new URL('../data/db.json.tmp', import.meta.url);
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, file);
  }, 300);
}

export function saveNow() {
  if (timer) { clearTimeout(timer); timer = null; }
  writeFileSync(file, JSON.stringify(db));
}
const blank = () => ({ messages: 0, voice: 0, coins: 0, crystals: 0, lastCoinMsg: 0, lastDaily: 0, streak: 0, pair: null, clanId: null, banner: false });
export function nextMonday() {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 1);
  return d.getTime();
}
export function weekBump(id, field, n) {
  data.week ??= { next: nextMonday(), users: {} };
  const w = (data.week.users[id] ??= { m: 0, v: 0 });
  w[field] += n;
}
export const getUser = (id) => (data.users[id] ??= blank());
