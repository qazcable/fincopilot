import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { cardHeight, type CardData, type CardTone } from "@/lib/domain/cards";

// Карточки всегда тёмные: так они выглядят дорого в любой теме Telegram
const C = {
  bg: "#09090c",
  surface: "#141418",
  surface2: "#1c1c22",
  fg: "#f4f4f7",
  muted: "#9a9aa8",
  faint: "#5c5c6a",
  accent: "#8b7fff",
  positive: "#34d399",
  negative: "#fb7185",
};

const TONE: Record<CardTone, string> = { accent: C.fg, positive: C.positive, negative: C.negative, muted: C.muted };
const TONE_BAR: Record<CardTone, string> = { accent: C.accent, positive: C.positive, negative: C.negative, muted: C.faint };
const TONE_CHIP: Record<CardTone, { bg: string; fg: string }> = {
  accent: { bg: "rgba(139,127,255,0.16)", fg: "#b8b0ff" },
  positive: { bg: "rgba(52,211,153,0.14)", fg: C.positive },
  negative: { bg: "rgba(251,113,133,0.14)", fg: C.negative },
  muted: { bg: C.surface2, fg: C.muted },
};
// Оттенки строк категорий — из одной фиолетово-холодной гаммы
const ROW_COLORS = ["#8b7fff", "#6ea8fe", "#34d399", "#f5b86b", "#f472b6"];

const WIDTH = 1200;

type Assets = { fonts: { name: string; data: Buffer; weight: 400 | 600 | 700 }[]; logo: string };

let assets: Promise<Assets> | null = null;

function loadAssets(): Promise<Assets> {
  assets ??= (async (): Promise<Assets> => {
    const dir = join(process.cwd(), "src/assets");
    const [regular, semibold, bold, logo] = await Promise.all([
      readFile(join(dir, "fonts/Onest-Regular.ttf")),
      readFile(join(dir, "fonts/Onest-SemiBold.ttf")),
      readFile(join(dir, "fonts/Onest-Bold.ttf")),
      readFile(join(dir, "brand/logo.svg")),
    ]);
    return {
      fonts: [
        { name: "Onest", data: regular, weight: 400 as const },
        { name: "Onest", data: semibold, weight: 600 as const },
        { name: "Onest", data: bold, weight: 700 as const },
      ],
      logo: `data:image/svg+xml;base64,${logo.toString("base64")}`,
    };
  })().catch(error => {
    assets = null;
    throw error;
  });
  return assets!;
}

/** Прогрев перед рассылкой: шрифты читаются один раз */
export function warmCards() {
  return loadAssets().then(() => undefined, () => undefined);
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function Badge({ kind }: { kind: "trophy" | "check" }) {
  return (
    <div style={{ display: "flex", width: 84, height: 84, borderRadius: 42, backgroundColor: kind === "trophy" ? "rgba(52,211,153,0.16)" : "rgba(139,127,255,0.18)", alignItems: "center", justifyContent: "center", marginBottom: 28 }}>
      {kind === "check" ? (
        <svg width="44" height="44" viewBox="0 0 24 24">
          <path d="M5 12.5L10 17L19 7.5" fill="none" stroke={C.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="44" height="44" viewBox="0 0 24 24">
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" fill={C.positive} />
          <path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 4M17 6h2.5a2.5 2.5 0 0 1-2.5 4" fill="none" stroke={C.positive} strokeWidth="1.8" />
          <path d="M10.5 14h3v3h-3zM8 18h8v2H8z" fill={C.positive} />
        </svg>
      )}
    </div>
  );
}

function Card({ card, logo }: { card: CardData; logo: string }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 72,
        fontFamily: "Onest", color: C.fg, backgroundColor: C.bg,
        backgroundImage: "radial-gradient(circle at 12% 0%, rgba(91,76,240,0.42), rgba(9,9,12,0) 55%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logo} width={52} height={52} style={{ borderRadius: 13 }} />
          <div style={{ display: "flex", marginLeft: 16, fontSize: 30, fontWeight: 700 }}>FinCopilot</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: C.muted }}>{clip(card.eyebrow, 40)}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 64 }}>
        {card.badge && <Badge kind={card.badge} />}
        <div style={{ display: "flex", fontSize: 34, color: C.muted }}>{clip(card.label, 44)}</div>
        <div style={{ display: "flex", marginTop: 6, fontSize: 116, fontWeight: 700, letterSpacing: -3, color: TONE[card.tone] }}>{card.amount}</div>
        {card.note && <div style={{ display: "flex", marginTop: 4, fontSize: 30, color: C.muted }}>{card.note}</div>}
      </div>

      {card.progress && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
          <div style={{ display: "flex", height: 18, borderRadius: 9, backgroundColor: C.surface2 }}>
            <div style={{ display: "flex", height: 18, borderRadius: 9, width: `${Math.round(Math.min(1, Math.max(0.03, card.progress.value)) * 100)}%`, backgroundColor: TONE_BAR[card.progress.tone] }} />
          </div>
          <div style={{ display: "flex", marginTop: 14, fontSize: 26, color: C.muted }}>{card.progress.caption}</div>
        </div>
      )}

      {card.chips && card.chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 32 }}>
          {card.chips.map(chip => (
            <div key={chip.text} style={{ display: "flex", marginRight: 14, padding: "10px 22px", borderRadius: 999, fontSize: 26, fontWeight: 600, backgroundColor: TONE_CHIP[chip.tone].bg, color: TONE_CHIP[chip.tone].fg }}>
              {clip(chip.text, 46)}
            </div>
          ))}
        </div>
      )}

      {card.rows && card.rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 44, padding: "28px 32px", borderRadius: 32, backgroundColor: C.surface }}>
          {card.rowsTitle && <div style={{ display: "flex", fontSize: 22, fontWeight: 600, letterSpacing: 2, color: C.faint, marginBottom: 8 }}>{card.rowsTitle.toUpperCase()}</div>}
          {card.rows.map((row, index) => (
            <div key={`${row.label}-${index}`} style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, backgroundColor: ROW_COLORS[index % ROW_COLORS.length] }} />
                  <div style={{ display: "flex", marginLeft: 16, fontSize: 30 }}>{clip(row.label, 30)}</div>
                </div>
                <div style={{ display: "flex", fontSize: 30, fontWeight: 600 }}>{row.value}</div>
              </div>
              {row.share !== undefined && (
                <div style={{ display: "flex", marginTop: 12, height: 8, borderRadius: 4, backgroundColor: C.surface2 }}>
                  <div style={{ display: "flex", height: 8, borderRadius: 4, width: `${Math.round(Math.min(1, Math.max(0.02, row.share)) * 100)}%`, backgroundColor: ROW_COLORS[index % ROW_COLORS.length] }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {card.footer && (
        <div style={{ display: "flex", marginTop: 36, paddingTop: 28, borderTop: `2px solid ${C.surface2}`, fontSize: 32, fontWeight: 600 }}>
          {card.footer}
        </div>
      )}
    </div>
  );
}

/** PNG карточки для отправки в Telegram */
export async function renderCard(card: CardData): Promise<Buffer> {
  const { fonts, logo } = await loadAssets();
  const response = new ImageResponse(<Card card={card} logo={logo} />, { width: WIDTH, height: cardHeight(card), fonts });
  return Buffer.from(await response.arrayBuffer());
}

/** Карточки можно выключить целиком: BOT_CARDS=off */
export function cardsEnabled() {
  return process.env.BOT_CARDS !== "off";
}
