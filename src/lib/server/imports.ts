import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ensureDefaultCategories } from "./auth";
import { accountMovementUntil, getDefaultAccount } from "./ledger";
import { extractPdfItems } from "./pdf";
import { categorizeMerchants } from "./ai";
import {
  classifyKaspiRow, findManualDuplicates, importKeys, isKaspiStatement, normalizeMerchant, parseKaspiStatement,
  type KaspiDecision, type KaspiRow,
} from "@/lib/domain/kaspi";
import { addDays, dayKeyOf, daysBetween, localDateTimeToInstant, startOfDayInstant } from "@/lib/domain/dates";
import { FALLBACK_CATEGORY_KEY } from "@/lib/domain/constants";
import { fromDb, toDb } from "@/lib/domain/money";
import type { ImportSummary } from "@/lib/domain/importText";

type ImportUser = { id: string; timezone: string };

type StoredRow = KaspiRow & {
  key: string;
  decision: KaspiDecision;
  duplicate: "imported" | "manual" | null;
};

export type DraftResult =
  | { ok: true; batchId: string; summary: ImportSummary }
  | { ok: false; reason: "not_kaspi" | "empty" };

/** Разбирает PDF, сверяет с уже внесёнными операциями и сохраняет черновик импорта */
export async function createKaspiDraft(user: ImportUser, pdf: Uint8Array): Promise<DraftResult> {
  const pages = await extractPdfItems(pdf);
  if (!isKaspiStatement(pages)) return { ok: false, reason: "not_kaspi" };

  const statement = parseKaspiStatement(pages);
  if (statement.rows.length === 0) return { ok: false, reason: "empty" };

  const account = await getDefaultAccount(user.id);
  const savings = await findSavingsAccount(user.id, account.id);
  const keys = importKeys(statement.rows);
  const decisions = statement.rows.map(classifyKaspiRow);
  const days = statement.rows.map(r => r.date).sort();
  const range = { gte: startOfDayInstant(addDays(days[0], -1), user.timezone), lt: startOfDayInstant(addDays(days.at(-1)!, 2), user.timezone) };

  const [imported, manual] = await Promise.all([
    prisma.transaction.findMany({ where: { userId: user.id, importKey: { in: keys } }, select: { importKey: true } }),
    prisma.transaction.findMany({
      where: { userId: user.id, importKey: null, scheduledPaymentId: null, occurredAt: range },
      select: { id: true, kind: true, amount: true, occurredAt: true },
    }),
  ]);
  const importedKeys = new Set(imported.map(t => t.importKey));

  // Кандидаты на сверку с ручными записями — только новые строки, которые будут импортированы
  const candidateIndexes = statement.rows
    .map((_, i) => i)
    .filter(i => decisions[i].action === "import" && !importedKeys.has(keys[i]));
  const manualDuplicates = findManualDuplicates(
    candidateIndexes.map(i => {
      const decision = decisions[i] as Extract<KaspiDecision, { action: "import" }>;
      return { kind: decision.kind, amount: Math.abs(statement.rows[i].amount), day: statement.rows[i].date };
    }),
    manual.map(t => ({ id: t.id, kind: t.kind, amount: fromDb(t.amount), day: dayKeyOf(t.occurredAt, user.timezone) })),
    daysBetween
  );

  const rows: StoredRow[] = statement.rows.map((row, i) => ({
    ...row,
    key: keys[i],
    decision: decisions[i],
    duplicate: importedKeys.has(keys[i]) ? "imported" : manualDuplicates.has(candidateIndexes.indexOf(i)) ? "manual" : null,
  }));

  const importable = rows.filter(r => r.decision.action === "import" && r.duplicate === null);
  // Переводы с депозитом учитываем, только если у пользователя заведён счёт накоплений
  const transfers = savings ? rows.filter(r => r.decision.action === "transfer" && r.duplicate === null) : [];
  const summary: ImportSummary = {
    cardMask: statement.cardMask,
    periodFrom: statement.periodFrom,
    periodTo: statement.periodTo,
    closingBalance: statement.closingBalance,
    total: rows.length,
    toImport: importable.length + transfers.length,
    alreadyImported: rows.filter(r => r.duplicate === "imported").length,
    manualDuplicates: rows.filter(r => r.duplicate === "manual").length,
    skippedOwn: rows.filter(r => r.decision.action === "skip" || (r.decision.action === "transfer" && !savings)).length,
    transfers: transfers.length,
    savingsAccountName: savings?.name ?? null,
    income: importable.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0),
    expense: importable.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0),
    needAi: importable.filter(r => r.decision.action === "import" && r.decision.needsAi).length,
  };

  // Старые неприменённые черновики больше не нужны
  await prisma.importBatch.deleteMany({ where: { userId: user.id, status: "DRAFT" } });
  const batch = await prisma.importBatch.create({
    data: {
      userId: user.id,
      accountId: account.id,
      bank: "KASPI_GOLD",
      periodFrom: statement.periodFrom,
      periodTo: statement.periodTo,
      closingBalance: statement.closingBalance === null ? null : toDb(statement.closingBalance),
      rows: rows as unknown as Prisma.InputJsonValue,
      summary: summary as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: true, batchId: batch.id, summary };
}

/** Счёт для переводов «На Kaspi Депозит»: сначала накопительный с «депозит» в названии, иначе первый накопительный */
async function findSavingsAccount(userId: string, excludeId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId, kind: "SAVINGS", archivedAt: null, id: { not: excludeId } },
    orderBy: { createdAt: "asc" },
  });
  return accounts.find(a => /депозит|deposit/i.test(a.name)) ?? accounts[0] ?? null;
}

export type ApplyResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; reason: "not_found" | "already_applied" | "cancelled" };

const CREATE_CHUNK = 500;

/** Применяет черновик: категории (выученные → ключевые слова → ИИ), операции, сверка баланса */
export async function applyImport(user: ImportUser, batchId: string): Promise<ApplyResult> {
  // «Захват» черновика, чтобы двойное нажатие не импортировало дважды
  const { count } = await prisma.importBatch.updateMany({
    where: { id: batchId, userId: user.id, status: "DRAFT" },
    data: { status: "APPLYING" },
  });
  if (count === 0) {
    const batch = await prisma.importBatch.findFirst({ where: { id: batchId, userId: user.id } });
    if (!batch) return { ok: false, reason: "not_found" };
    return { ok: false, reason: batch.status === "CANCELLED" ? "cancelled" : "already_applied" };
  }

  try {
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    const newRows = (batch.rows as unknown as StoredRow[]).filter(r => r.duplicate === null);
    const rows = newRows.filter(r => r.decision.action === "import");
    const summary = batch.summary as unknown as ImportSummary;
    const savings = summary.transfers ? await findSavingsAccount(user.id, batch.accountId) : null;

    await ensureDefaultCategories(user.id);
    const [categories, learned] = await Promise.all([
      prisma.category.findMany({ where: { userId: user.id, archivedAt: null } }),
      prisma.merchantCategory.findMany({ where: { userId: user.id } }),
    ]);
    const byKey = new Map(categories.filter(c => c.key).map(c => [`${c.kind}:${c.key}`, c.id]));
    const learnedByMerchant = new Map(learned.map(m => [m.merchant, m.categoryId]));

    // Названия, для которых нет ни выученной категории, ни ключевого слова, — спрашиваем ИИ
    const unknown = [...new Set(
      rows
        .filter(r => r.decision.action === "import" && r.decision.needsAi && !learnedByMerchant.has(normalizeMerchant(r.details)))
        .map(r => normalizeMerchant(r.details))
    )];
    const expenseCategories = categories.filter(c => c.kind === "EXPENSE").map(c => ({ id: c.id, name: c.name, kind: c.kind }));
    const aiResult = await categorizeMerchants(unknown, expenseCategories);
    const aiByMerchant = new Map<string, string>();
    aiResult.forEach((categoryId, index) => aiByMerchant.set(unknown[index], categoryId));

    if (aiByMerchant.size > 0) {
      await prisma.merchantCategory.createMany({
        data: [...aiByMerchant].map(([merchant, categoryId]) => ({ userId: user.id, merchant, categoryId })),
        skipDuplicates: true,
      });
    }

    const data: Prisma.TransactionCreateManyInput[] = rows.map(row => {
      const decision = row.decision as Extract<KaspiDecision, { action: "import" }>;
      const merchant = normalizeMerchant(row.details);
      const categoryId =
        learnedByMerchant.get(merchant) ??
        (decision.categoryKey ? byKey.get(`${decision.kind}:${decision.categoryKey}`) : undefined) ??
        aiByMerchant.get(merchant) ??
        byKey.get(`${decision.kind}:${FALLBACK_CATEGORY_KEY[decision.kind]}`) ??
        null;
      return {
        userId: user.id,
        accountId: batch.accountId,
        categoryId,
        kind: decision.kind,
        amount: toDb(Math.abs(row.amount)),
        // В выписке нет времени — ставим полдень, чтобы операция точно попала в свой день
        occurredAt: localDateTimeToInstant(`${row.date}T12:00`, user.timezone)!,
        note: decision.note.slice(0, 200),
        source: "IMPORT",
        rawInput: [row.operation, row.foreign ? `(${row.foreign})` : null].filter(Boolean).join(" ").slice(0, 500),
        importBatchId: batch.id,
        importKey: row.key,
      };
    });

    // Переводы между картой и депозитом — не расход и не доход, а движение между своими счетами
    if (savings) {
      for (const row of newRows) {
        if (row.decision.action !== "transfer") continue;
        const out = row.decision.direction === "out";
        data.push({
          userId: user.id,
          kind: "TRANSFER",
          accountId: out ? batch.accountId : savings.id,
          toAccountId: out ? savings.id : batch.accountId,
          categoryId: null,
          amount: toDb(Math.abs(row.amount)),
          occurredAt: localDateTimeToInstant(`${row.date}T12:00`, user.timezone)!,
          note: row.decision.note.slice(0, 200),
          source: "IMPORT",
          rawInput: row.operation.slice(0, 500),
          importBatchId: batch.id,
          importKey: row.key,
        });
      }
    }

    const imported = await prisma.$transaction(async tx => {
      let created = 0;
      for (let i = 0; i < data.length; i += CREATE_CHUNK) {
        created += (await tx.transaction.createMany({ data: data.slice(i, i + CREATE_CHUNK), skipDuplicates: true })).count;
      }

      // Сверка: баланс счёта на конец периода выписки должен совпасть с остатком Kaspi
      const account = await tx.account.findUniqueOrThrow({ where: { id: batch.accountId } });
      let previousOpeningBalance: bigint | null = null;
      if (batch.closingBalance !== null && batch.periodTo) {
        const until = startOfDayInstant(addDays(batch.periodTo, 1), user.timezone);
        const balanceAtEnd = fromDb(account.openingBalance) + await accountMovementUntil(tx, account.id, until);
        previousOpeningBalance = account.openingBalance;
        await tx.account.update({
          where: { id: account.id },
          data: { openingBalance: toDb(fromDb(account.openingBalance) + fromDb(batch.closingBalance) - balanceAtEnd) },
        });
      }

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "APPLIED",
          appliedAt: new Date(),
          previousOpeningBalance,
          summary: { ...summary, imported: created } as unknown as Prisma.InputJsonValue,
        },
      });
      return created;
    }, { timeout: 60_000, maxWait: 10_000 });

    return { ok: true, summary: { ...summary, imported } };
  } catch (error) {
    await prisma.importBatch.updateMany({ where: { id: batchId, status: "APPLYING" }, data: { status: "DRAFT" } });
    throw error;
  }
}

/** Отмена: черновик просто закрывается, применённый импорт удаляет свои операции и возвращает баланс */
export async function cancelImport(user: ImportUser, batchId: string) {
  return prisma.$transaction(async tx => {
    const batch = await tx.importBatch.findFirst({ where: { id: batchId, userId: user.id } });
    if (!batch || batch.status === "CANCELLED" || batch.status === "APPLYING") return null;

    let removed = 0;
    if (batch.status === "APPLIED") {
      removed = (await tx.transaction.deleteMany({ where: { importBatchId: batch.id, userId: user.id } })).count;
      if (batch.previousOpeningBalance !== null) {
        await tx.account.updateMany({
          where: { id: batch.accountId, userId: user.id },
          data: { openingBalance: batch.previousOpeningBalance },
        });
      }
    }
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    return { removed, wasApplied: batch.status === "APPLIED" };
  }, { timeout: 30_000 });
}

/**
 * Повторный подбор категорий для операций из выписки, оставшихся в «Другое» (например, если ИИ был перегружен).
 * Ручные правки не трогает: берутся только операции с категорией «Другое» и магазины без выученной категории.
 */
export async function retryImportCategories(userId: string, batchSize = 40) {
  const other = await prisma.category.findFirst({ where: { userId, key: FALLBACK_CATEGORY_KEY.EXPENSE, kind: "EXPENSE" } });
  if (!other) return { merchants: 0, categorized: 0, updated: 0 };

  const [rows, learned, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, source: "IMPORT", kind: "EXPENSE", categoryId: other.id, note: { not: null } },
      select: { id: true, note: true },
    }),
    prisma.merchantCategory.findMany({ where: { userId }, select: { merchant: true } }),
    prisma.category.findMany({ where: { userId, kind: "EXPENSE", archivedAt: null }, select: { id: true, name: true, kind: true } }),
  ]);
  const known = new Set(learned.map(m => m.merchant));
  const merchants = [...new Set(rows.map(r => normalizeMerchant(r.note!)))].filter(m => !known.has(m));
  const aiResult = await categorizeMerchants(merchants, categories, batchSize);

  const byMerchant = new Map<string, string>();
  aiResult.forEach((categoryId, index) => byMerchant.set(merchants[index], categoryId));
  if (byMerchant.size > 0) {
    await prisma.merchantCategory.createMany({
      data: [...byMerchant].map(([merchant, categoryId]) => ({ userId, merchant, categoryId })),
      skipDuplicates: true,
    });
  }

  let updated = 0;
  for (const [merchant, categoryId] of byMerchant) {
    if (categoryId === other.id) continue;
    const ids = rows.filter(r => normalizeMerchant(r.note!) === merchant).map(r => r.id);
    updated += (await prisma.transaction.updateMany({ where: { id: { in: ids }, categoryId: other.id }, data: { categoryId } })).count;
  }
  return { merchants: merchants.length, categorized: byMerchant.size, updated };
}

/** Когда пользователь меняет категорию операции из выписки — запоминаем магазин */
export async function rememberMerchantCategory(userId: string, transactionId: string, categoryId: string | null) {
  if (!categoryId) return;
  const tx = await prisma.transaction.findFirst({ where: { id: transactionId, userId, source: "IMPORT", kind: "EXPENSE" } });
  if (!tx?.note) return;
  const merchant = normalizeMerchant(tx.note.replace(/^Возврат:\s*/, ""));
  await prisma.merchantCategory.upsert({
    where: { userId_merchant: { userId, merchant } },
    create: { userId, merchant, categoryId },
    update: { categoryId },
  });
}

export async function listImports(userId: string) {
  const batches = await prisma.importBatch.findMany({
    where: { userId, status: { in: ["APPLIED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, periodFrom: true, periodTo: true, summary: true, appliedAt: true, cancelledAt: true },
  });
  return batches.map(b => ({
    id: b.id,
    status: b.status as "APPLIED" | "CANCELLED",
    periodFrom: b.periodFrom,
    periodTo: b.periodTo,
    imported: (b.summary as unknown as ImportSummary).imported ?? 0,
  }));
}
