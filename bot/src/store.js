import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
const dir = new URL('../data/', import.meta.url);
const file = new URL('../data/db.json', import.meta.url);
mkdirSync(dir, { recursive: true });
const def = { caseCounter: 0, cases: [], ticketCounter: 0, tickets: {}, appCounter: 0, apps: {} };
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
