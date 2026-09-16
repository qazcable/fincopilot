import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Домены туннеля (cloudflared/ngrok) для проверки Mini App из Telegram во время разработки
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map(origin => origin.trim()).filter(Boolean),
  poweredByHeader: false,
  // Шрифты и логотип для карточек бота читаются с диска в API-маршрутах
  outputFileTracingIncludes: {
    "/api/**": ["./src/assets/fonts/**", "./src/assets/brand/**"],
  },
};

export default nextConfig;
