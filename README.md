# FinCopilot

Личные финансы в Telegram: **сколько можно потратить сегодня**, чтобы хватило на все платежи до зарплаты.

- Траты — сообщением или голосовым боту («кофе 1200», «такси 2.5к»), кнопкой «+» в Mini App или кнопкой Action Button на iPhone.
- Кредиты, рассрочки, кредитки и регулярные счета превращаются в график платежей.
- Итоги в боте: утром — лимит на день и ближайшие платежи, вечером — итоги дня, по понедельникам — итоги недели.
- Месячные лимиты по категориям: бот предупреждает на 80% и 100%.
- Лимит на день = (баланс − платежи до зарплаты − неприкосновенный запас) / дни до зарплаты.

## Стек

Next.js 16 (App Router, Server Actions) · React 19 · Tailwind CSS 4 · Prisma 6 (PostgreSQL / Neon) · grammY · Gemini · Zod · Vitest

## Устройство

```
src/lib/domain/    чистая логика без БД: деньги, даты в часовом поясе, разбор фраз, график, лимит (+ тесты)
src/lib/server/    работа с БД и внешними сервисами: учёт, платежи, бот, ИИ, авторизация
src/lib/actions/   Server Actions для Mini App (всегда проверяют пользователя из сессии)
src/app/(app)/     экраны: главная, история, платежи, аналитика, настройки
src/app/api/       вход через Telegram, вебхук бота, быстрая команда iPhone, крон утренних/вечерних итогов
```

Ключевые решения:

- **Деньги — целые тиыны** (`BigInt` в БД). Никаких `Float`.
- **Баланс не хранится**: начальный остаток + доходы − расходы. Правка и удаление операций не рассинхронизируют баланс.
- **Обязательства → конкретные платежи** (`ScheduledPayment`) со статусом «ожидается / оплачен / пропущен». Удаление операции оплаты возвращает платёж и долг.
- **Даты считаются в часовом поясе пользователя**, а не сервера.
- **ИИ только разбирает текст**; простые фразы разбираются регулярным выражением без обращения к Gemini. Все расчёты — в коде.
- Трата в категории «Кредиты и счета» с суммой ближайшего платежа автоматически отмечает этот платёж оплаченным.

## Запуск локально

Локальная база — встроенный Postgres от Prisma (не трогает рабочую базу Neon):

```bash
npm install
npx prisma dev --name fincopilot --detach   # локальный Postgres на localhost:51214
cp .env.example .env                          # заполнить TELEGRAM_BOT_TOKEN, SESSION_SECRET, GEMINI_API_KEY
npx prisma migrate deploy
npm run dev
```

Строка подключения к локальной базе (в `.env` и `.env.development.local` — последний перекрывает продакшен-строки из `.env.local`, созданного `vercel link`):

```
postgres://postgres:postgres@localhost:51214/postgres?sslmode=disable&connection_limit=1&connect_timeout=0&max_idle_connection_lifetime=0&pool_timeout=0&socket_timeout=0&pgbouncer=true
```

Особенности `prisma dev`: сервер держит одно соединение (не запускайте скрипты параллельно с `npm run dev`), а `prisma migrate dev` с ним не работает — новые миграции создаются так:

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<дата>_<имя>/migration.sql
npx prisma migrate deploy
```

В обычном браузере приложение откроется под пользователем `DEV_TELEGRAM_ID` (только в dev-режиме).

Проверки:

```bash
npm test
npm run typecheck
npm run lint
```

## Деплой

Хостинг — **Vercel**, база — **Neon Postgres** (подключается через Storage → Neon в проекте Vercel и сама создаёт `DATABASE_URL` и `DATABASE_URL_UNPOOLED`).

- Деплой из CLI: `npx vercel@latest deploy --prod` (репозиторий к Vercel не подключён). Скрипт `vercel-build` применяет миграции (`prisma migrate deploy`) перед сборкой.
- Остальные переменные из `.env.example` добавляются в Settings → Environment Variables (`DEV_TELEGRAM_ID` в продакшене не нужен).
- Vercel Cron из `vercel.json`: `/api/cron/morning` в 04:00 UTC (09:00 в Алматы) — утренний прогноз, платежи и итоги недели по понедельникам; `/api/cron/evening` в 16:00 UTC (21:00) — итоги дня. Запросы приходят с `Authorization: Bearer $CRON_SECRET`, повторный запуск в тот же день ничего не дублирует.

После первого деплоя укажите `APP_URL` (адрес проекта) и зарегистрируйте бота:

```bash
npm run bot:webhook     # вебхук, команды (/today, /week, /limits, /help) и кнопка меню Mini App
```

Чтобы ботом пользовались только вы, укажите свой Telegram ID в `ALLOWED_TELEGRAM_IDS`.

## Кнопка Action Button (iPhone)

В настройках приложения создайте ключ, затем в «Командах»: **Диктовать текст → Получить содержимое URL** (POST `APP_URL/api/shortcut`, заголовок `Authorization: Bearer fc_…`, JSON `{"text": <диктовка>}`) → **Показать результат**. Назначьте команду на Action Button.
