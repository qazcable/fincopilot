import "server-only";
import { getDocumentProxy } from "unpdf";
import type { TextItem } from "@/lib/domain/kaspi";

const MAX_PAGES = 200;

/** Текстовые фрагменты каждой страницы PDF с координатами (x — слева, y — снизу) */
export async function extractPdfItems(data: Uint8Array): Promise<TextItem[][]> {
  // pdf.js забирает буфер себе (transfer) — передаём копию, чтобы исходные данные оставались пригодными
  const pdf = await getDocumentProxy(data.slice());
  const pages: TextItem[][] = [];
  try {
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item && typeof item.str === "string")
          .map(item => ({ x: item.transform[4], y: item.transform[5], text: item.str }))
      );
    }
  } finally {
    await pdf.cleanup();
  }
  return pages;
}
