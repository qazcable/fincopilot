import "server-only";
import { parseNbkRss, type NbkRates } from "@/lib/domain/currency";

const NBK_RSS = "https://nationalbank.kz/rss/rates_all.xml";
// Нацбанк публикует курс раз в день — кэша на час достаточно
const REVALIDATE_SECONDS = 3600;

let lastGood: NbkRates | null = null;

/** Официальные курсы Нацбанка РК. При сбое сайта — последние полученные курсы (или пустой список) */
export async function getNbkRates(): Promise<NbkRates> {
  try {
    const response = await fetch(NBK_RSS, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`NBK ${response.status}`);
    const parsed = parseNbkRss(await response.text());
    if (parsed.rates.length === 0) throw new Error("NBK: empty rates");
    lastGood = parsed;
    return parsed;
  } catch (error) {
    console.error("NBK rates failed:", error instanceof Error ? error.message : String(error));
    return lastGood ?? { date: null, rates: [] };
  }
}
