# TnQko bot

Discord-бот для сервера TnQko: **модерация**, **тикеты**, **заявки в команду** (RU/EN, язык выбирается по локали пользователя).

## Возможности
- **Модерация:** `/warn` `/mute` `/unmute` `/kick` `/ban` `/unban` `/purge` `/history`. Кейсы нумеруются и пишутся в `logs`. 3 предупреждения за 30 дней = автомут на 1 час. Лёгкий автомод: спам, массовые упоминания, инвайты (инвайты только при `MESSAGE_CONTENT=1`).
- **Тикеты:** кнопки в `🎫・tickets` (вопрос, жалоба, партнёрство, сотрудничество), приватный канал в категории `TICKETS`, кнопки «Взять» и «Закрыть», транскрипт в `logs`, автозакрытие через 48 ч неактивности, лимит 2 открытых тикета на человека.
- **Заявки:** кнопки в `📝・applications` (Moderator, Media), форма, анкета в `STAFF/applications` с кнопками принять/отклонить (отказ повторно через 14 дней). При принятии выдаётся роль `Mod | discord` или `Media`.

## Права
| Действие | Роли |
|---|---|
| warn, mute, unmute, purge, history | Mod \| discord и выше |
| kick, решения по заявкам | Curator \| discord и выше |
| ban, unban | Administrator \| discord, Curator \| qko, Manager, Agency |

ID ролей и каналов лежат в `config.json`.

## Запуск
```bash
cp .env.example .env   # вписать BOT_TOKEN
npm install
npm start              # при старте сам регистрирует слэш-команды
npm run panels         # один раз: опубликовать панели тикетов и заявок
```
В Developer Portal → Bot включить **Message Content Intent**, только если нужен автомод инвайтов, и тогда `MESSAGE_CONTENT=1`.

### Pterodactyl
Яйцо Node.js (Node 20+). Загрузить содержимое папки `bot/`, переменные: `BOT_TOKEN`, при необходимости `MESSAGE_CONTENT`. Стартовый файл `src/index.js`. Папку `data/` (там JSON-база кейсов и тикетов) нужно сохранять между перезапусками.
