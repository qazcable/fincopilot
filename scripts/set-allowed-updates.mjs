// Включает апдейт «stopped_message_generation» (кнопка «Стоп» у живого ответа советника),
// не трогая остальной вебхук. Нельзя просто добавить тип апдейта — setWebhook переписывает
// всю конфигурацию целиком, и без секрета Telegram его сбрасывает, а бот перестаёт отвечать.
//
// npm run bot:updates            — только показать текущую настройку
// npm run bot:updates -- --apply — применить (тот же URL, тот же секрет, без drop_pending_updates)
import { readFileSync, existsSync } from "node:fs";

function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  }
}

loadEnv();
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret } = process.env;
if (!token || !secret) {
  console.error("Нужны TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET — это переменные прод-окружения, не локальные заглушки.");
  process.exit(1);
}

async function call(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

const ALLOWED_UPDATES = ["message", "callback_query", "stopped_message_generation"];

const before = await call("getWebhookInfo");
console.log("Сейчас:", { url: before.url, allowed_updates: before.allowed_updates, pending_update_count: before.pending_update_count });

if (!process.argv.includes("--apply")) {
  console.log("\nЭто был просмотр. Чтобы применить — добавьте --apply.");
  process.exit(0);
}
if (!before.url) {
  console.error("У бота ещё не настроен вебхук — сначала npm run bot:webhook.");
  process.exit(1);
}

await call("setWebhook", { url: before.url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
const after = await call("getWebhookInfo");
console.log("Стало:", { url: after.url, allowed_updates: after.allowed_updates });
console.log("✅ Готово. Напишите боту /today, чтобы проверить, что он ещё отвечает.");
