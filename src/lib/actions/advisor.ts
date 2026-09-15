"use server";

import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { ADVISOR_ERRORS, askAdvisor } from "@/lib/server/advisor";

const question = z.string().trim().min(1).max(1000);

export async function askAdvisorAction(input: string): Promise<{ ok: true; answer: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = question.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Напишите вопрос" };
  const result = await askAdvisor(user, parsed.data, "APP");
  return result.ok ? { ok: true, answer: result.answer } : { ok: false, error: ADVISOR_ERRORS[result.reason] };
}
