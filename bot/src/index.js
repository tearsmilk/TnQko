import 'dotenv/config';
import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { handleCommand, automod } from './moderation.js';
import { handleButton, touch, startIdleCloser } from './tickets.js';
import { handleApp } from './applications.js';
import * as profile from './profile.js';
import * as social from './social.js';
import * as top from './top.js';
import * as shop from './shop.js';
import * as giveaway from './giveaway.js';
import * as rooms from './voicerooms.js';
import * as events from './events.js';
import { onMessage, onVoice, startVoiceTracking } from './tracking.js';
import { registerCommands } from './deploy.js';
import { cfg } from './config.js';

const content = process.env.MESSAGE_CONTENT === '1';
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers, ...(content ? [GatewayIntentBits.MessageContent] : [])],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await registerCommands().catch((e) => console.error('command registration failed', e.message));
  startIdleCloser(c);
  startVoiceTracking(c);
  top.startWeekly(c);
  events.startEventScheduler(c);
  rooms.cleanup(c).catch((e) => console.error('rooms cleanup', e.message));
  giveaway.startGiveawayTimer(c);
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.customId?.startsWith('vr:')) await rooms.handle(i);
    else if (i.isChatInputCommand()) { (await handleCommand(i)) || (await profile.handleCommand(i)) || (await social.handleCommand(i)) || (await top.handleCommand(i)) || (await shop.handleCommand(i)) || (await giveaway.handleCommand(i)) || (await events.handleCommand(i)); }
    else if ((i.isButton() || i.isModalSubmit()) && i.customId.startsWith('ap:')) await handleApp(i);
    else if (i.isButton()) { (await social.handleButton(i)) || (await giveaway.handleButton(i)) || (await events.handleButton(i)) || (await handleButton(i)); }
  } catch (e) {
    console.error(e);
    const msg = { content: '❌ Ошибка', flags: MessageFlags.Ephemeral };
    if (i.replied || i.deferred) await i.followUp(msg).catch(() => {}); else await i.reply(msg).catch(() => {});
  }
});

client.on(Events.GuildMemberAdd, (m) => {
  if (m.user.bot || !cfg.roles.guest) return;
  m.roles.add(cfg.roles.guest, 'Автовыдача при входе').catch((e) => console.error('guest role', e.message));
});
client.on(Events.VoiceStateUpdate, (o, n) => { onVoice(o, n); rooms.onVoice(o, n); });
client.on(Events.MessageCreate, (m) => { onMessage(m); touch(m); automod(m).catch((e) => console.error('automod', e.message)); });
process.on('unhandledRejection', (e) => console.error('unhandled', e));
client.login(process.env.BOT_TOKEN);
