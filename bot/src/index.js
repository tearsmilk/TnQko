import 'dotenv/config';
import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { handleCommand, automod } from './moderation.js';
import { handleButton, touch, startIdleCloser } from './tickets.js';
import { handleApp } from './applications.js';
import { registerCommands } from './deploy.js';

const content = process.env.MESSAGE_CONTENT === '1';
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, ...(content ? [GatewayIntentBits.MessageContent] : [])],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await registerCommands().catch((e) => console.error('command registration failed', e.message));
  startIdleCloser(c);
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) await handleCommand(i);
    else if ((i.isButton() || i.isModalSubmit()) && i.customId.startsWith('ap:')) await handleApp(i);
    else if (i.isButton()) await handleButton(i);
  } catch (e) {
    console.error(e);
    const msg = { content: '❌ Error / Ошибка', flags: MessageFlags.Ephemeral };
    if (i.replied || i.deferred) await i.followUp(msg).catch(() => {}); else await i.reply(msg).catch(() => {});
  }
});

client.on(Events.MessageCreate, (m) => { touch(m); automod(m).catch((e) => console.error('automod', e.message)); });
process.on('unhandledRejection', (e) => console.error('unhandled', e));
client.login(process.env.BOT_TOKEN);
