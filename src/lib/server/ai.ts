import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { MAX_AMOUNT_MINOR, MINOR_PER_UNIT } from "@/lib/domain/money";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

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
