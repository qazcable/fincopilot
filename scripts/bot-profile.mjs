// Имя, описание и аватар бота. Вебхук не трогает.
// npm run bot:profile                 — показать тексты и их длину
// npm run bot:profile -- --apply      — записать тексты в Telegram
// npm run bot:profile -- --photo a.jpg — поставить аватар (только JPG)
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

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

const PROFILE = {
  name: { value: "FinCopilot", limit: 64 },
  short_description: {
    value: "Сколько можно потратить сегодня — чтобы хватило до зарплаты. Траты голосом, платежи, итоги.",
    limit: 120,
  },
  description: {
    value: [
      "FinCopilot — личный финансовый помощник.",
      "",
      "💸 Каждое утро — сколько можно потратить сегодня, чтобы денег хватило до зарплаты.",
      "🎙 Траты сообщением или голосом: «кофе 1200».",
      "🔔 Напомню о кредитах и платежах заранее.",
      "📊 Итоги дня и недели, цели и ИИ-советник.",
      "",
      "Сделано в Казахстане. Закрытая бета — вход по приглашению.",
    ].join("\n"),
    limit: 512,
  },
};

async function call(method, body) {
  const init = body instanceof FormData
    ? { method: "POST", body }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, init);
  const json = await response.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

let tooLong = false;
for (const [key, { value, limit }] of Object.entries(PROFILE)) {
  const length = [...value].length;
  if (length > limit) tooLong = true;
  console.log(`${key}: ${length}/${limit}${length > limit ? "  ← СЛИШКОМ ДЛИННО" : ""}\n${value}\n`);
}
if (tooLong) process.exit(1);

const args = process.argv.slice(2);

if (args.includes("--apply")) {
  // Без языка — для всех, и отдельно для русского интерфейса
  for (const language_code of [undefined, "ru"]) {
    await call("setMyName", { name: PROFILE.name.value, language_code });
    await call("setMyDescription", { description: PROFILE.description.value, language_code });
    await call("setMyShortDescription", { short_description: PROFILE.short_description.value, language_code });
  }
  console.log("✅ Имя и описания обновлены");
}

const photoIndex = args.indexOf("--photo");
if (photoIndex >= 0) {
  const path = args[photoIndex + 1];
  if (!path || !/\.jpe?g$/i.test(path) || !existsSync(path)) {
    console.error("Укажите существующий JPG: --photo avatar.jpg");
    process.exit(1);
  }
  const form = new FormData();
  form.append("photo", JSON.stringify({ type: "static", photo: "attach://avatar" }));
  form.append("avatar", new Blob([readFileSync(path)], { type: "image/jpeg" }), basename(path));
  await call("setMyProfilePhoto", form);
  console.log("✅ Аватар обновлён");
}
