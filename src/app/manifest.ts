import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinCopilot",
    short_name: "FinCopilot",
    description: "Сколько можно потратить сегодня — чтобы хватило до зарплаты",
    start_url: "/",
    display: "standalone",
    background_color: "#09090c",
    theme_color: "#5b4cf0",
    lang: "ru",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
