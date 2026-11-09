import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { cfg } from './config.js';
import { commands } from './moderation.js';

export async function registerCommands() {
  const rest = new REST().setToken(process.env.BOT_TOKEN);
  const me = await rest.get(Routes.user('@me'));
  const res = await rest.put(Routes.applicationGuildCommands(me.id, cfg.guildId), { body: commands });
  console.log(`Registered ${res.length} commands`);
}
if (import.meta.url === `file://${process.argv[1]}`) await registerCommands();
