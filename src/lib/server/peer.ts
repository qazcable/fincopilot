import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { fromDb } from "@/lib/domain/money";
import { NOT_TRANSIT, PEER_IN_WHERE, PEER_OUT_WHERE } from "@/lib/domain/constants";

/** Суммы переводов людям за период: сколько ушло и сколько пришло (транзит не входит) */
export async function peerSums(userId: string, occurredAt: { gte: Date; lt: Date }, extra: Prisma.TransactionWhereInput = {}) {
  const base = { userId, occurredAt, ...extra };
  const [out, incoming] = await Promise.all([
    prisma.transaction.aggregate({ where: { AND: [base, PEER_OUT_WHERE, NOT_TRANSIT] }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { AND: [base, PEER_IN_WHERE, NOT_TRANSIT] }, _sum: { amount: true } }),
  ]);
  return { out: fromDb(out._sum.amount), in: fromDb(incoming._sum.amount) };
}
