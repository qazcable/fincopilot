import "server-only";

// Простое ограничение частоты в памяти процесса — защита квоты ИИ от скриптов.
// Для нескольких инстансов нужен общий стор (Redis), для одного сервера этого достаточно.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
