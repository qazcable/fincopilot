// Регистрирует вебхук бота и команды.
// Использование: APP_URL=https://your-domain npm run bot:webhook  (переменные берутся из .env)
import { readFileSync, existsSync } from "node:fs";

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

loadEnv();
const { TELEGRAM_BOT_TOKEN: token, APP_URL: appUrl, TELEGRAM_WEBHOOK_SECRET: secret } = process.env;

if (!token || !appUrl?.startsWith("https://") || !secret) {
  console.error("Нужны TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и APP_URL (https://…)");
  process.exit(1);
}

async function call(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

const url = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;
await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
await call("setMyCommands", {
  commands: [
    { command: "today", description: "Сколько можно потратить сегодня" },
    { command: "week", description: "Траты за 7 дней" },
    { command: "limits", description: "Лимиты по категориям" },
    { command: "help", description: "Как записывать траты" },
  ],
});
await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Финансы", web_app: { url: appUrl } } });

const me = await call("getMe", {});
console.log(`Готово: @${me.username} → ${url}`);
