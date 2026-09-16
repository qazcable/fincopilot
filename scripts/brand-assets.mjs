// Генерирует файлы бренда из src/assets/brand/logo.svg: иконки приложения, OG-картинку и картинки для Telegram.
// Запуск: node scripts/brand-assets.mjs (sharp и next/og уже есть в node_modules)
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import sharp from "sharp";
import React from "react";
import { ImageResponse } from "next/dist/compiled/@vercel/og/index.node.js";

const h = React.createElement;
const logo = readFileSync("src/assets/brand/logo.svg");
const logoUri = `data:image/svg+xml;base64,${logo.toString("base64")}`;
const fonts = [
  { name: "Onest", data: readFileSync("src/assets/fonts/Onest-Regular.ttf"), weight: 400 },
  { name: "Onest", data: readFileSync("src/assets/fonts/Onest-Bold.ttf"), weight: 700 },
];

async function png(element, width, height) {
  const res = new ImageResponse(element, { width, height, fonts });
  return Buffer.from(await res.arrayBuffer());
}

function banner({ height, logoSize, title, subtitle, titleSize, subtitleSize }) {
  return h("div", {
    style: {
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      width: "100%", height: "100%", fontFamily: "Onest", color: "#f4f4f7",
      backgroundColor: "#09090c",
      backgroundImage: "radial-gradient(circle at 50% 30%, rgba(139,127,255,0.38), rgba(9,9,12,0) 60%)",
    },
  },
    h("img", { src: logoUri, width: logoSize, height: logoSize, style: { borderRadius: logoSize * 0.23 } }),
    h("div", { style: { display: "flex", marginTop: height * 0.06, fontSize: titleSize, fontWeight: 700, letterSpacing: -1 } }, title),
    h("div", { style: { display: "flex", marginTop: height * 0.02, fontSize: subtitleSize, color: "#9a9aa8" } }, subtitle),
  );
}

// Иконки приложения
copyFileSync("src/assets/brand/logo.svg", "src/app/icon.svg");
await sharp(logo).resize(180, 180).png().toFile("src/app/apple-icon.png");

// Аватар бота: Telegram принимает только JPG
await sharp(logo).resize(640, 640).flatten({ background: "#5b4cf0" }).jpeg({ quality: 92 }).toFile("src/assets/brand/avatar.jpg");

// Иконка экрана загрузки Mini App
await sharp(logo).resize(512, 512).png().toFile("src/assets/brand/loading.png");

// Картинка для превью ссылки
writeFileSync("src/app/opengraph-image.png", await png(
  banner({ width: 1200, height: 630, logoSize: 150, title: "FinCopilot", subtitle: "Сколько можно потратить сегодня — чтобы хватило до зарплаты", titleSize: 84, subtitleSize: 32 }),
  1200, 630,
));

// Картинка в пустом чате с ботом (BotFather → Edit Description Picture)
writeFileSync("src/assets/brand/telegram-description.png", await png(
  banner({ width: 640, height: 360, logoSize: 92, title: "FinCopilot", subtitle: "Личный финансовый помощник", titleSize: 46, subtitleSize: 20 }),
  640, 360,
));

console.log("✅ Бренд-файлы обновлены");
