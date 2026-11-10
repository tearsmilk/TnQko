import { readFileSync } from 'node:fs';
export const cfg = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const r = cfg.roles;
// Permission levels (highest roles can do everything lower ones can)
export const L3 = [r.admin, r.curatorQko, r.manager, r.agency];          // ban / unban, setup
export const L2 = [r.curatorDiscord, ...L3];                              // kick, review applications
export const L1 = [r.mod, ...L2];                                         // warn, mute, purge, history, tickets
export const LEADERS = [r.agency, r.manager, r.curatorQko, r.admin];      // partnership / collab tickets
