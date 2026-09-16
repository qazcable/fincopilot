// Меню команд бота. Вебхук не трогает: npm run bot:commands
import { readFileSync, existsSync } from "node:fs";

for (const file of [".env", ".env.local"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Нужен TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

export const COMMANDS = [
  { command: "today", description: "Сколько можно потратить сегодня" },
  { command: "week", description: "Траты за 7 дней" },
  { command: "limits", description: "Лимиты по категориям" },
  { command: "advice", description: "Разбор финансов от ИИ-советника" },
  { command: "guide", description: "Инструкция: как всё работает" },
  { command: "rates", description: "Курс валют Нацбанка" },
  { command: "subscribe", description: "Тариф и подписка Pro" },
  { command: "feedback", description: "Отзыв или идея" },
  { command: "help", description: "Как записывать траты" },
];

const response = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands: COMMANDS }),
});
const json = await response.json();
if (!json.ok) {
  console.error(`setMyCommands: ${json.description}`);
  process.exit(1);
}
console.log(`✅ Команд в меню: ${COMMANDS.length}`);
