import { cfg } from './config.js';
/** Бот работает только на русском: английский аргумент оставлен для совместимости и игнорируется. */
export const t = (_i, ru) => ru;
export const hasLevel = (member, roles) => member?.roles?.cache?.some((x) => roles.includes(x.id)) || member?.permissions?.has('Administrator');
export const V2 = 32768; // MessageFlags.IsComponentsV2
const clip = (x, n = 3900) => (String(x).length > n ? `${String(x).slice(0, n - 1)}…` : String(x));

/** Карточка Components V2 с интерфейсом, как у EmbedBuilder. Отправляется через msg(). */
class Card {
  constructor(title, desc) { this.title = title; this.desc = desc ?? null; this.fields = []; this.footer = null; this.thumb = null; this.image = null; this.color = cfg.color; }
  setColor(c) { this.color = c; return this; }
  setThumbnail(url) { this.thumb = url; return this; }
  setImage(url) { this.image = url; return this; }
  setFooter(f) { this.footer = f.text; return this; }
  setTimestamp() { return this; }
  addFields(...f) { this.fields.push(...f.flat()); return this; }
  toJSON(rows = [], files = []) {
    const text = (content) => ({ type: 10, content });
    const head = this.title ? `### ${this.title}${this.desc ? `\n${this.desc}` : ''}` : (this.desc ?? '');
    const body = this.fields.map((f) => `**${f.name}**\n${f.value}`).join('\n\n');
    const parts = [this.thumb
      ? { type: 9, components: [text(clip(head))], accessory: { type: 11, media: { url: this.thumb } } }
      : text(clip(head))];
    if (body) parts.push({ type: 14, divider: true, spacing: 1 }, text(clip(body)));
    if (this.image) parts.push({ type: 12, items: [{ media: { url: this.image } }] });
    if (this.footer) parts.push({ type: 14, divider: false, spacing: 1 }, text(`-# ${clip(this.footer, 200)}`));
    for (const f of files) parts.push({ type: 13, file: { url: `attachment://${f.name}` } });
    parts.push(...rows);
    return { type: 17, accent_color: this.color, components: parts };
  }
}
export const embed = (title, desc) => new Card(title, desc);
/** Собирает сообщение Components V2 из карточки (+ кнопки / файлы / доп. параметры). */
export const msg = (card, rows = [], extra = {}) => {
  const { flags = 0, files, ...rest } = extra;
  return { ...rest, flags: flags | V2, files, components: [card.toJSON(rows, files ?? [])] };
};
export async function sendLog(client, e, files) {
  try {
    const ch = await client.channels.fetch(cfg.channels.logs);
    await ch.send(msg(e, [], { files }));
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

const fence = (x) => `\`\`\`\n${String(x).replaceAll('```', "'''").slice(0, 900)}\n\`\`\``;
/** Красивая карточка активности (ивент, розыгрыш и т.п.): заголовок, описание в блоке кода, список, награды, картинка, подпись. */
export function activity({ title, subtitle, description, bullets = [], rewards = [], image, footer, color = cfg.color }) {
  const text = (content) => ({ type: 10, content: clip(content) });
  const parts = [text(`## ${title}${subtitle ? `\n-# ${subtitle}` : ''}`)];
  if (description) parts.push(text(fence(description)));
  if (bullets.length) parts.push(text(bullets.map((b) => `• ${b}`).join('\n')));
  if (rewards.length) parts.push(text(rewards.map((r) => `• ${r}`).join('    ')));
  if (image) parts.push({ type: 12, items: [{ media: { url: image } }] });
  if (footer) parts.push({ type: 14, divider: false, spacing: 1 }, text(`-# ${footer}`));
  return { type: 17, accent_color: color, components: parts };
}
/** Сообщение Components V2: (пинг-текст) + контейнер + кнопки под ним, вне контейнера. */
export const post = (container, rows = [], { ping, ...extra } = {}) => ({
  ...extra, flags: (extra.flags ?? 0) | V2,
  components: [...(ping ? [{ type: 10, content: ping }] : []), container, ...rows],
});
