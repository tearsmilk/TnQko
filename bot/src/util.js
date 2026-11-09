import { EmbedBuilder } from 'discord.js';
import { cfg } from './config.js';
export const loc = (i) => (String(i.locale ?? i.guildLocale ?? '').startsWith('ru') ? 'ru' : 'en');
export const t = (i, ru, en) => (loc(i) === 'ru' ? ru : en);
export const hasLevel = (member, roles) => member?.roles?.cache?.some((x) => roles.includes(x.id)) || member?.permissions?.has('Administrator');
export const embed = (title, desc) => new EmbedBuilder().setColor(cfg.color).setTitle(title).setDescription(desc ?? null).setTimestamp();
export async function sendLog(client, e, files) {
  try {
    const ch = await client.channels.fetch(cfg.channels.logs);
    await ch.send({ embeds: [e], files });
  } catch (err) { console.error('log failed', err.message); }
}
export function parseDuration(s) {
  const m = /^(\d+)\s*(s|m|h|d|w)$/i.exec(String(s).trim());
  if (!m) return null;
  const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2].toLowerCase()];
  const ms = Number(m[1]) * mult;
  return ms > 0 && ms <= 28 * 864e5 ? ms : null;
}
export const fmtDur = (ms) => {
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || `${Math.round(ms / 1e3)}s`;
};
export const top = (member) => member.roles.highest.position;
