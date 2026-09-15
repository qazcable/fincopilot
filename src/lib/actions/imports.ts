"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { cancelImport } from "@/lib/server/imports";
import type { ActionResult } from "./transactions";

export async function cancelImportAction(batchId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await cancelImport(user, String(batchId));
  if (!result) return { ok: false, error: "Импорт уже отменён" };
  revalidatePath("/", "layout");
  return { ok: true };
}
