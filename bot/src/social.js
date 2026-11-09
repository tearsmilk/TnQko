import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { data, getUser, save } from './store.js';
import { t, embed } from './util.js';
import { displayName } from './profile.js';

const eph = MessageFlags.Ephemeral;
const TTL = 10 * 6e4, CLAN_COST = 500, CLAN_MAX = 15;
const NAME_RE = /^[A-Za-z0-9Ѐ-ӿ _-]{2,20}$/;
const userOpt = (o) => o.setName('user').setDescription('User / Пользователь').setRequired(true);

export const commands = [
  new SlashCommandBuilder().setName('pair').setDescription('Pair / Пара')
    .addSubcommand((s) => s.setName('propose').setDescription('Propose to a user / Предложить пару').addUserOption(userOpt))
    .addSubcommand((s) => s.setName('break').setDescription('Break the pair / Расстаться')),
  new SlashCommandBuilder().setName('clan').setDescription('Clans / Кланы')
    .addSubcommand((s) => s.setName('create').setDescription(`Create a clan (${CLAN_COST} coins) / Создать клан`)
      .addStringOption((o) => o.setName('name').setDescription('2-20 chars: letters, digits, space, _ -').setRequired(true).setMaxLength(20)))
    .addSubcommand((s) => s.setName('invite').setDescription('Invite a user / Пригласить').addUserOption(userOpt))
    .addSubcommand((s) => s.setName('kick').setDescription('Kick a member / Исключить').addUserOption(userOpt))
    .addSubcommand((s) => s.setName('leave').setDescription('Leave your clan / Покинуть клан'))
    .addSubcommand((s) => s.setName('disband').setDescription('Disband your clan / Распустить клан'))
    .addSubcommand((s) => s.setName('info').setDescription('Clan info / Информация о клане')
      .addStringOption((o) => o.setName('name').setDescription('Clan name (default: yours)'))),
].map((c) => c.setContexts(0).toJSON());

const buttons = (prefix, i, args) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${prefix}:accept:${args}:${Date.now()}`).setLabel(t(i, 'Принять', 'Accept')).setEmoji('✅').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`${prefix}:decline:${args}:${Date.now()}`).setLabel(t(i, 'Отклонить', 'Decline')).setEmoji('❌').setStyle(ButtonStyle.Danger));
const say = (i, ru, en) => i.reply({ content: t(i, ru, en), flags: eph });
const findClan = (name) => Object.values(data.clans).find((c) => c.name.toLowerCase() === name.toLowerCase());

function dissolve(clan) {
  for (const id of clan.members) getUser(id).clanId = null;
  delete data.clans[clan.id]; save();
}

export async function handleCommand(i) {
  if (i.commandName === 'pair') {
    const me = getUser(i.user.id);
    if (i.options.getSubcommand() === 'break') {
      if (!me.pair) return say(i, 'У тебя нет пары.', 'You have no pair.'), true;
      getUser(me.pair.id).pair = null; me.pair = null; save();
      await i.reply({ content: t(i, '💔 Пара распалась.', '💔 The pair has been broken.') });
      return true;
    }
    const target = i.options.getUser('user');
    if (target.bot || target.id === i.user.id) return say(i, 'Выбери другого человека.', 'Pick someone else.'), true;
    if (me.pair) return say(i, 'У тебя уже есть пара.', 'You already have a pair.'), true;
    if (getUser(target.id).pair) return say(i, 'У этого пользователя уже есть пара.', 'That user already has a pair.'), true;
    await i.reply({ content: `${target}`, allowedMentions: { users: [target.id] },
      embeds: [embed('💞 Pair / Пара', `${i.user} → ${target}\n${t(i, 'Предложение действует 10 минут.', 'The proposal is valid for 10 minutes.')}`)],
      components: [buttons('pr', i, `${i.user.id}:${target.id}`)] });
    return true;
  }
  if (i.commandName !== 'clan') return false;
  const sub = i.options.getSubcommand(), me = getUser(i.user.id), clan = me.clanId ? data.clans[me.clanId] : null;
  if (sub === 'create') {
    const name = i.options.getString('name').trim();
    if (clan) return say(i, 'Ты уже состоишь в клане.', 'You are already in a clan.'), true;
    if (!NAME_RE.test(name)) return say(i, 'Название: 2-20 символов, латиница, кириллица, цифры, пробел, _ и -.', 'Name: 2-20 chars, Latin/Cyrillic letters, digits, space, _ and -.'), true;
    if (findClan(name)) return say(i, 'Такой клан уже есть.', 'That clan already exists.'), true;
    if (me.coins < CLAN_COST) return say(i, `Нужно ${CLAN_COST} монет.`, `You need ${CLAN_COST} coins.`), true;
    me.coins -= CLAN_COST;
    const id = String(++data.clanCounter);
    data.clans[id] = { id, name, ownerId: i.user.id, members: [i.user.id], createdAt: Date.now() };
    me.clanId = id; save();
    await i.reply({ content: t(i, `🛡️ Клан **${name}** создан!`, `🛡️ Clan **${name}** created!`) });
  } else if (sub === 'info') {
    const n = i.options.getString('name'), c = n ? findClan(n) : clan;
    if (!c) return say(i, 'Клан не найден.', 'Clan not found.'), true;
    await i.reply({ embeds: [embed(`🛡️ ${c.name}`).addFields(
      { name: t(i, 'Глава', 'Owner'), value: `<@${c.ownerId}>`, inline: true },
      { name: t(i, 'Участники', 'Members'), value: `${c.members.length}/${CLAN_MAX}`, inline: true },
      { name: t(i, 'Состав', 'Roster'), value: c.members.map((m) => `<@${m}>`).join(' ') })], allowedMentions: { parse: [] } });
  } else {
    if (!clan) return say(i, 'Ты не состоишь в клане.', 'You are not in a clan.'), true;
    const owner = clan.ownerId === i.user.id;
    if (sub === 'leave') {
      if (owner && clan.members.length > 1) return say(i, 'Глава не может уйти: распусти клан или исключи участников.', 'The owner cannot leave: disband the clan or kick the members.'), true;
      if (owner) dissolve(clan); else { clan.members = clan.members.filter((m) => m !== i.user.id); me.clanId = null; save(); }
      await i.reply({ content: t(i, '👋 Ты покинул клан.', '👋 You left the clan.') });
    } else if (!owner) return say(i, 'Только глава клана может это делать.', 'Only the clan owner can do this.'), true;
    else if (sub === 'disband') { const n = clan.name; dissolve(clan); await i.reply({ content: t(i, `💥 Клан **${n}** распущен.`, `💥 Clan **${n}** disbanded.`) }); }
    else {
      const target = i.options.getUser('user');
      if (sub === 'kick') {
        if (target.id === i.user.id || !clan.members.includes(target.id)) return say(i, 'Этого пользователя нет в клане.', 'That user is not in your clan.'), true;
        clan.members = clan.members.filter((m) => m !== target.id); getUser(target.id).clanId = null; save();
        await i.reply({ content: t(i, `🚪 ${target} исключён из клана.`, `🚪 ${target} was kicked from the clan.`), allowedMentions: { parse: [] } });
      } else if (sub === 'invite') {
        if (target.bot || getUser(target.id).clanId) return say(i, 'Нельзя пригласить этого пользователя.', 'You cannot invite this user.'), true;
        if (clan.members.length >= CLAN_MAX) return say(i, `В клане максимум ${CLAN_MAX} участников.`, `A clan holds at most ${CLAN_MAX} members.`), true;
        await i.reply({ content: `${target}`, allowedMentions: { users: [target.id] },
          embeds: [embed(`🛡️ ${clan.name}`, t(i, `${target}, тебя приглашают в клан. Приглашение действует 10 минут.`, `${target}, you are invited to the clan. Valid for 10 minutes.`))],
          components: [buttons('cl', i, `${clan.id}:${target.id}`)] });
      }
    }
  }
  return true;
}

export async function handleButton(i) {
  const [ns, action, a, b, ts] = i.customId.split(':');
  if (ns !== 'pr' && ns !== 'cl') return false;
  const toId = b;
  if (i.user.id !== toId && !(ns === 'pr' && action === 'decline' && i.user.id === a)) return i.reply({ content: '⛔', flags: eph }), true;
  const done = (ru, en) => i.update({ content: t(i, ru, en), embeds: [], components: [] });
  if (Date.now() - Number(ts) > TTL) { await done('⌛ Предложение истекло.', '⌛ The offer has expired.'); return true; }
  if (action === 'decline') { await done('❌ Отклонено.', '❌ Declined.'); return true; }
  if (ns === 'pr') {
    const x = getUser(a), y = getUser(b);
    if (x.pair || y.pair) { await done('Кто-то из вас уже в паре.', 'One of you already has a pair.'); return true; }
    const since = Date.now(); x.pair = { id: b, since }; y.pair = { id: a, since }; save();
    await i.update({ content: `💞 <@${a}> + <@${b}>`, embeds: [], components: [], allowedMentions: { parse: [] } });
  } else {
    const clan = data.clans[a], u = getUser(b);
    if (!clan || u.clanId) { await done('Приглашение больше не действует.', 'The invite is no longer valid.'); return true; }
    if (clan.members.length >= CLAN_MAX) { await done('Клан заполнен.', 'The clan is full.'); return true; }
    clan.members.push(b); u.clanId = clan.id; save();
    await i.update({ content: t(i, `✅ <@${b}> вступил в клан **${clan.name}**.`, `✅ <@${b}> joined clan **${clan.name}**.`), embeds: [], components: [], allowedMentions: { parse: [] } });
  }
  return true;
}
