import "server-only";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { z } from "zod";
import { MAX_AMOUNT_MINOR, MINOR_PER_UNIT } from "@/lib/domain/money";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Разбор трат и категорий — простая классификация: без размышлений ответы те же, а выходных токенов в разы меньше
const THINKING = { thinkingLevel: ThinkingLevel.LOW };

let client: GoogleGenAI | null = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function isAiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export type AiCategory = { id: string; name: string; kind: string };

const aiResult = z.object({
  amount: z.number(),
  kind: z.enum(["EXPENSE", "INCOME"]),
  categoryId: z.string(),
  note: z.string(),
  confidence: z.number().min(0).max(1),
});

export type AiParsed = { amount: number; kind: "EXPENSE" | "INCOME"; categoryId: string | null; note: string };

const MIN_CONFIDENCE = 0.55;

/** Разбор свободного текста или голосового в операцию. Суммы в ответе — в тенге, возвращаем тиыны. */
export async function parseWithAi(
  input: { text: string } | { audio: Buffer; mimeType: string },
  categories: AiCategory[]
): Promise<AiParsed | null> {
  const ai = getClient();
  if (!ai) return null;

  const categoryList = categories.map(c => `${c.id} — ${c.name} (${c.kind})`).join("\n");
  const instruction = `Ты разбираешь личные финансовые операции пользователя из Казахстана.
Извлеки одну операцию. Валюта по умолчанию — тенге (₸). "2.5к", "две с половиной тысячи" = 2500.
kind: EXPENSE — трата, INCOME — поступление (зарплата, перевод мне, кэшбэк).
categoryId: выбери ровно один id из списка, подходящий по kind:
${categoryList}
note: короткое описание с заглавной буквы, без суммы (например "Такси до офиса").
confidence: 0..1. Если сумма не названа или речь не о деньгах — confidence ниже 0.5.`;

  const contents = "text" in input
    ? [{ role: "user", parts: [{ text: input.text }] }]
    : [{ role: "user", parts: [{ inlineData: { data: input.audio.toString("base64"), mimeType: input.mimeType } }, { text: "Разбери эту голосовую запись." }] }];

  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: instruction,
      thinkingConfig: THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          amount: { type: Type.NUMBER },
          kind: { type: Type.STRING, enum: ["EXPENSE", "INCOME"] },
          categoryId: { type: Type.STRING, enum: categories.map(c => c.id) },
          note: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ["amount", "kind", "categoryId", "note", "confidence"],
      },
    },
  });

  let parsed: z.infer<typeof aiResult>;
  try {
    parsed = aiResult.parse(JSON.parse(response.text ?? ""));
  } catch {
    return null;
  }

  const amount = Math.round(parsed.amount * MINOR_PER_UNIT);
  if (parsed.confidence < MIN_CONFIDENCE || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT_MINOR) return null;

  const category = categories.find(c => c.id === parsed.categoryId && c.kind === parsed.kind);
  return { amount, kind: parsed.kind, categoryId: category?.id ?? null, note: parsed.note.trim().slice(0, 200) };
}

const merchantResult = z.object({
  items: z.array(z.object({ index: z.number().int(), categoryId: z.string() })),
});

const MERCHANT_BATCH = 120;
const RETRY_DELAYS_MS = [2_000, 6_000];

/** Повтор запроса при временной перегрузке модели (429/503) */
async function withRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Дневная квота не восстановится за секунды — повторять бессмысленно
      const dailyQuota = /PerDay/i.test(message);
      const transient = !dailyQuota && /\b(429|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(message);
      if (!transient || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * Категории для названий магазинов из выписки: один запрос на пачку названий.
 * Возвращает индекс названия → id категории; нераспознанные не попадают в результат.
 */
export async function categorizeMerchants(names: string[], categories: AiCategory[], batchSize = MERCHANT_BATCH): Promise<Map<number, string>> {
  const ai = getClient();
  const result = new Map<number, string>();
  if (!ai || names.length === 0 || categories.length === 0) return result;

  const categoryIds = categories.map(c => c.id);
  const categoryList = categories.map(c => `${c.id} — ${c.name}`).join("\n");

  for (let start = 0; start < names.length; start += batchSize) {
    const batch = names.slice(start, start + batchSize);
    const list = batch.map((name, i) => `${start + i}. ${name}`).join("\n");
    try {
      const response = await withRetry(() => ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: list }] }],
        config: {
          systemInstruction: `Это названия получателей платежей по карте Kaspi (Казахстан): магазины, кафе, ИП, сервисы.
Для каждого номера выбери категорию расходов из списка. ИП и ТОО с непонятным названием — «Другое».
Категории:
${categoryList}`,
          thinkingConfig: THINKING,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { index: { type: Type.INTEGER }, categoryId: { type: Type.STRING, enum: categoryIds } },
                  required: ["index", "categoryId"],
                },
              },
            },
            required: ["items"],
          },
        },
      }));
      const parsed = merchantResult.parse(JSON.parse(response.text ?? ""));
      for (const item of parsed.items) {
        if (item.index >= start && item.index < start + batch.length && categoryIds.includes(item.categoryId)) {
          result.set(item.index, item.categoryId);
        }
      }
    } catch (error) {
      // Пачка без ИИ-категорий получит «Другое» — импорт не должен падать из-за ИИ
      console.error("Merchant categorization failed:", error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}