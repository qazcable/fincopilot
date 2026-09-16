"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { cancelImport, dismissTransferSuggestions, forgetImport, linkTransferSuggestions } from "@/lib/server/imports";
import type { ActionResult } from "./transactions";

/** Удаляет запись об отменённом импорте из истории */
export async function forgetImportAction(batchId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!(await forgetImport(user.id, String(batchId)))) return { ok: false, error: "Сначала отмените импорт" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function cancelImportAction(batchId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await cancelImport(user, String(batchId));
  if (!result) return { ok: false, error: "Импорт уже отменён" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Подтверждение: эти пары — переводы между своими картами */
export async function linkTransfersAction(outIds: string[]): Promise<ActionResult> {
  const user = await requireUser();
  const ids = (Array.isArray(outIds) ? outIds : []).map(String).slice(0, 200);
  if (ids.length === 0) return { ok: false, error: "Нечего связывать" };
  const linked = await linkTransferSuggestions(user, ids);
  if (linked === 0) return { ok: false, error: "Эти операции уже изменились — обновите страницу" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** «Это не мои переводы» — больше не предлагать связывать */
export async function dismissTransfersAction(ids: string[]): Promise<ActionResult> {
  const user = await requireUser();
  await dismissTransferSuggestions(user, (Array.isArray(ids) ? ids : []).map(String).slice(0, 400));
  revalidatePath("/", "layout");
  return { ok: true };
}
