import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { cfg } from './config.js';
import { commands as mod } from './moderation.js';
import { commands as prof } from './profile.js';
import { commands as soc } from './social.js';
import { commands as tp } from './top.js';
import { commands as sh } from './shop.js';
import { commands as gw } from './giveaway.js';
import { commands as evc } from './events.js';
const commands = [...mod, ...prof, ...soc, ...tp, ...sh, ...gw, ...evc];

export async function registerCommands() {
  const rest = new REST().setToken(process.env.BOT_TOKEN);
  const me = await rest.get(Routes.user('@me'));
  const res = await rest.put(Routes.applicationGuildCommands(me.id, cfg.guildId), { body: commands });
  console.log(`Registered ${res.length} commands`);
}
if (import.meta.url === `file://${process.argv[1]}`) await registerCommands();
