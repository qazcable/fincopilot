"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { createInvite, inviteLink, isOwner, revokeInvite } from "@/lib/server/access";
import { saveFeedback } from "@/lib/server/feedback";
import type { ActionResult } from "./transactions";

export async function createInviteAction(note: string): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!isOwner(user.telegramId)) return { ok: false, error: "Приглашать может только владелец" };
  const invite = await createInvite(user.id, z.string().max(60).catch("").parse(note));
  const link = inviteLink(invite.code);
  if (!link) return { ok: false, error: "Не задано имя бота (NEXT_PUBLIC_BOT_USERNAME)" };
  revalidatePath("/settings");
  return { ok: true, link };
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!isOwner(user.telegramId)) return { ok: false, error: "Нет доступа" };
  if (!(await revokeInvite(user.id, String(inviteId)))) return { ok: false, error: "Приглашение не найдено" };
  revalidatePath("/settings");
  return { ok: true };
}

const feedbackSchema = z.object({ text: z.string().trim().min(3, "Напишите пару слов").max(4000), page: z.string().max(100).nullable() });

export async function sendFeedbackAction(input: z.infer<typeof feedbackSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте текст" };
  await saveFeedback(user, parsed.data.text, "APP", parsed.data.page);
  return { ok: true };
}
