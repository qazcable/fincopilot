import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendScheduledDigests } from "@/lib/server/bot";

// Vercel Cron присылает Authorization: Bearer $CRON_SECRET (расписание — в vercel.json)
function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** /api/cron/morning — лимит на день, платежи, итоги недели по понедельникам; /api/cron/evening — итоги дня */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slot: string }> }) {
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slot } = await params;
  if (slot !== "morning" && slot !== "evening") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, slot, ...(await sendScheduledDigests(slot)) });
}
