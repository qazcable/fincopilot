"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { cancelImport, forgetImport } from "@/lib/server/imports";
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
