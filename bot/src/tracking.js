import { getUser, save, saveNow, weekBump } from './store.js';

const sessions = new Map(); // userId -> { last, channelId }
const COIN_PER_MSG = 3, MSG_COOLDOWN = 60e3, VOICE_COIN_PER_30S = 1;

export function onMessage(m) {
  if (m.author.bot || !m.guild) return;
  const u = getUser(m.author.id);
  u.messages += 1; weekBump(m.author.id, 'm', 1);
  if (Date.now() - u.lastCoinMsg >= MSG_COOLDOWN) { u.coins += COIN_PER_MSG; u.lastCoinMsg = Date.now(); }
  save();
}

function eligible(state) {
  if (!state.channel || !state.member || state.member.user.bot) return false;
  if (state.guild.afkChannelId && state.channelId === state.guild.afkChannelId) return false;
  return true;
}
function flush(id, state) {
  const s = sessions.get(id); if (!s) return;
  const now = Date.now(), secs = Math.floor((now - s.last) / 1000);
  s.last = now;
  if (secs <= 0) return;
  const u = getUser(id);
  u.voice += secs; weekBump(id, 'v', secs);
  const humans = state?.channel?.members?.filter((x) => !x.user.bot).size ?? 0;
  if (humans >= 2 && !state.selfDeaf && !state.serverDeaf) u.coins += Math.floor(secs / 30) * VOICE_COIN_PER_30S;
}

export function onVoice(oldS, newS, guild) {
  const id = (newS.member ?? oldS.member)?.id; if (!id) return;
  if (sessions.has(id)) flush(id, oldS.channel ? oldS : newS);
  if (eligible(newS)) { if (!sessions.has(id)) sessions.set(id, { last: Date.now() }); } else sessions.delete(id);
  save();
}

export function startVoiceTracking(client) {
  for (const g of client.guilds.cache.values())
    for (const st of g.voiceStates.cache.values()) if (eligible(st)) sessions.set(st.id, { last: Date.now() });
  setInterval(() => {
    for (const g of client.guilds.cache.values())
      for (const id of [...sessions.keys()]) {
        const st = g.voiceStates.cache.get(id);
        if (!st || !eligible(st)) { flush(id, st); sessions.delete(id); } else flush(id, st);
      }
    save();
  }, 60e3);
  const bye = () => { for (const g of client.guilds.cache.values()) for (const id of [...sessions.keys()]) flush(id, g.voiceStates.cache.get(id)); saveNow(); process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}
