import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { cfg } from './config.js';
import { getUser, save } from './store.js';
import { embed, msg, t } from './util.js';

const eph = MessageFlags.Ephemeral;
const PRICE = 1000, CUSTOM_PRICE = 800;
const COLORS = cfg.shopColors;

export const commands = [new SlashCommandBuilder().setName('shop').setDescription('Магазин')
  .addSubcommand((s) => s.setName('list').setDescription('Показать магазин'))
  .addSubcommand((s) => s.setName('buy').setDescription(`Buy a color role (${PRICE} coins) / Купить цвет`)
    .addStringOption((o) => o.setName('color').setDescription('Цвет').setRequired(true).addChoices(...COLORS.map((c) => ({ name: `${c.name} #${c.hex}`, value: c.key })))))
  .addSubcommand((s) => s.setName('custom').setDescription(`Your own HEX color (${CUSTOM_PRICE} crystals) / Свой цвет`)
    .addStringOption((o) => o.setName('hex').setDescription('Например #A58A91').setRequired(true).setMaxLength(7)))
  .addSubcommand((s) => s.setName('remove').setDescription('Снять цвета'))
  .setContexts(0).toJSON()];

const shopRoleIds = () => COLORS.map((c) => c.roleId);

export async function handleCommand(i) {
  if (i.commandName !== 'shop') return false;
  const sub = i.options.getSubcommand(), u = getUser(i.user.id);
  if (sub === 'list') {
    await i.reply(msg(embed('🛍️ Магазин',
      `**${PRICE} 🪙** — ${t(i, 'цвет ника', 'name color')}:\n${COLORS.map((c) => `<@&${c.roleId}>`).join(' ')}\n\n**${CUSTOM_PRICE} 💎** — ${t(i, 'свой HEX-цвет (`/shop custom`)', 'your own HEX color (`/shop custom`)')}\n\n` +
      `Твой баланс: **${u.coins}** 🪙 · **${u.crystals}** 💎\nКупить цвет: \`/shop buy\``), [], { flags: eph, allowedMentions: { parse: [] } }));
    return true;
  }
  const member = i.member;
  try {
    if (sub === 'buy') {
      const c = COLORS.find((x) => x.key === i.options.getString('color'));
      if (member.roles.cache.has(c.roleId)) return i.reply({ content: t(i, 'Этот цвет у тебя уже есть.', 'You already have this color.'), flags: eph }), true;
      if (u.coins < PRICE) return i.reply({ content: t(i, `Нужно ${PRICE} монет.`, `You need ${PRICE} coins.`), flags: eph }), true;
      await member.roles.remove(shopRoleIds().filter((id) => member.roles.cache.has(id)), 'shop');
      await member.roles.add(c.roleId, 'shop');
      u.coins -= PRICE; save();
      await i.reply({ content: t(i, `✅ Цвет **${c.name}** куплен.`, `✅ Color **${c.name}** purchased.`), flags: eph });
    } else if (sub === 'custom') {
      const m = /^#?([0-9a-f]{6})$/i.exec(i.options.getString('hex').trim());
      if (!m) return i.reply({ content: t(i, 'Формат: #A58A91', 'Format: #A58A91'), flags: eph }), true;
      if (u.crystals < CUSTOM_PRICE) return i.reply({ content: t(i, `Нужно ${CUSTOM_PRICE} кристаллов.`, `You need ${CUSTOM_PRICE} crystals.`), flags: eph }), true;
      const color = parseInt(m[1], 16);
      let role = u.customRole ? await i.guild.roles.fetch(u.customRole).catch(() => null) : null;
      if (role) await role.setColor(color, 'shop'); else {
        role = await i.guild.roles.create({ name: `custom-${i.user.id.slice(-4)}`, color, permissions: [], reason: 'shop custom color' });
        u.customRole = role.id;
      }
      await member.roles.add(role, 'shop');
      u.crystals -= CUSTOM_PRICE; save();
      await i.reply({ content: t(i, `✅ Свой цвет #${m[1].toUpperCase()} установлен.`, `✅ Custom color #${m[1].toUpperCase()} set.`), flags: eph });
    } else if (sub === 'remove') {
      await member.roles.remove([...shopRoleIds(), ...(u.customRole ? [u.customRole] : [])].filter((id) => member.roles.cache.has(id)), 'shop');
      await i.reply({ content: '✅', flags: eph });
    }
  } catch (err) {
    console.error('shop', err);
    await (i.replied ? i.followUp : i.reply).call(i, { content: t(i, '❌ Не удалось выдать роль. Сообщи стаффу.', '❌ Could not give the role. Tell the staff.'), flags: eph });
  }
  return true;
}
