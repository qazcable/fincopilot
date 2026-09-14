import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendPaymentReminders } from "@/lib/server/bot";

// Vercel Cron присылает Authorization: Bearer $CRON_SECRET; на VPS — вызывать curl из crontab
function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sent = await sendPaymentReminders();
  return NextResponse.json({ ok: true, sent });
}
