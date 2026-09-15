import { NextRequest, NextResponse } from "next/server";
import { validateInitData } from "@/lib/server/telegram-auth";
import { hasAccessByTelegramId } from "@/lib/server/access";
import { upsertTelegramUser } from "@/lib/server/auth";
import { createSession } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const initData = body?.initData;
  if (typeof initData !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const tgUser = validateInitData(initData);
  if (!tgUser) return NextResponse.json({ error: "Invalid initData" }, { status: 401 });
  if (!(await hasAccessByTelegramId(tgUser.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const user = await upsertTelegramUser(tgUser);
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
