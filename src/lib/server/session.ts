import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "fc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function createSession(userId: string) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ userId, exp: expiresAt })).toString("base64url");
  (await cookies()).set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: true,
    // Telegram Web открывает Mini App в iframe
    sameSite: "none",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function readSession(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value || !process.env.SESSION_SECRET) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const { userId, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof userId !== "string" || typeof exp !== "number" || exp < Date.now()) return null;
    return userId;
  } catch {
    return null;
  }
}
