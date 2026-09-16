import "server-only";
import type { Account, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ensureDefaultCategories } from "./auth";
import { accountMovementUntil, getDefaultAccount, resolveCategoryId } from "./ledger";
import { extractPdfItems } from "./pdf";
import { categorizeMerchants } from "./ai";
import { findManualDuplicates, normalizeMerchant, type KaspiDecision, type KaspiRow } from "@/lib/domain/kaspi";
import {
  BANKS, classifyStatementRow, detectStatement, matchOwnTransfers, mentionsOwner, ownTransferSignal, pairOwnTransfers, pairTransit, statementImportKeys,
  type BankCode, type ParsedStatement, type StatementDecision, type TransferCandidate, type TransferCounterpart,
} from "@/lib/domain/statements";
import { addDays, dayKeyOf, daysBetween, localDateTimeToInstant, startOfDayInstant } from "@/lib/domain/dates";
import { FALLBACK_CATEGORY_KEY } from "@/lib/domain/constants";
import { fromDb, toDb } from "@/lib/domain/money";
import type { ImportLink, ImportSummary } from "@/lib/domain/importText";

type ImportUser = { id: string; timezone: string };

type StoredRow = KaspiRow & {
  key: string;
  decision: StatementDecision;
  duplicate: "imported" | "manual" | null;
};

type ImportDecision = Extract<KaspiDecision, { action: "import" }>;

export type DraftResult =
  | { ok: true; batchId: string; summary: ImportSummary }
  | { ok: false; reason: "not_supported" | "empty" };

// Категории, в которые попадают переводы — среди них ищется парная операция другой своей карты
const TRANSFER_EXPENSE_KEYS = ["transfers"];
const TRANSFER_INCOME_KEYS = ["gift_in", "other_in"];

const noteOf = (decision: StatementDecision) => ("note" in decision ? decision.note : "");

const summaryOf = (batch: { summary: Prisma.JsonValue }) => batch.summary as unknown as ImportSummary;

/**
 * Счёт для выписки: Kaspi Gold — основной счёт; другие банки — счёт с номером карты или названием банка.
 * Если такого нет, он будет создан при импорте.
 */
async function resolveAccount(userId: string, statement: ParsedStatement): Promise<{ account: Account | null; newAccountName: string | null }> {
  if (statement.bank === "KASPI_GOLD") return { account: await getDefaultAccount(userId), newAccountName: null };
  const accounts = await prisma.account.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "asc" } });
  const digits = statement.cardMask?.replace(/\D/g, "");
  const bank = BANKS[statement.bank];
  const account =
    (digits ? accounts.find(a => a.name.includes(digits)) : undefined) ??
    accounts.find(a => bank.nameHints.test(a.name));
  return account
    ? { account, newAccountName: null }
    : { account: null, newAccountName: `${bank.title}${statement.cardMask ? ` ${statement.cardMask}` : ""}` };
}

/** Ключи строк, уже учтённых через связанные переводы в других импортах */
async function linkedKeys(userId: string) {
  const batches = await prisma.importBatch.findMany({ where: { userId, status: "APPLIED" }, select: { summary: true } });
  return new Set(batches.flatMap(b => summaryOf(b).linkedKeys ?? []));
}

/** Владелец карт (фамилия и имя) — из этой выписки или из прошлых импортов других банков */
async function ownerFor(userId: string, statement: ParsedStatement) {
  if (statement.owner) return statement.owner;
  const batches = await prisma.importBatch.findMany({ where: { userId, status: "APPLIED" }, orderBy: { createdAt: "desc" }, select: { summary: true } });
  return batches.map(b => summaryOf(b).owner).find(Boolean) ?? null;
}

/** Разбирает PDF, сверяет с уже внесёнными операциями и сохраняет черновик импорта */
export async function createStatementDraft(user: ImportUser, pdf: Uint8Array): Promise<DraftResult> {
  const pages = await extractPdfItems(pdf);
  const statement = detectStatement(pages);
  if (!statement) return { ok: false, reason: "not_supported" };
  if (statement.rows.length === 0) return { ok: false, reason: "empty" };

  const { account, newAccountName } = await resolveAccount(user.id, statement);
  const savings = statement.bank === "KASPI_GOLD" && account ? await findSavingsAccount(user.id, account.id) : null;
  const keys = statementImportKeys(statement);
  const decisions = statement.rows.map(row => classifyStatementRow(statement, row));
  const days = statement.rows.map(r => r.date).sort();
  const range = { gte: startOfDayInstant(addDays(days[0], -1), user.timezone), lt: startOfDayInstant(addDays(days.at(-1)!, 2), user.timezone) };

  const [imported, manual, linked, owner] = await Promise.all([
    prisma.transaction.findMany({ where: { userId: user.id, importKey: { in: keys } }, select: { importKey: true } }),
    // Ручные записи сверяются только со счётом выписки; для нового счёта их нет
    account
      ? prisma.transaction.findMany({
        where: { userId: user.id, accountId: account.id, importKey: null, scheduledPaymentId: null, kind: { in: ["EXPENSE", "INCOME"] }, occurredAt: range },
        select: { id: true, kind: true, amount: true, occurredAt: true },
      })
      : Promise.resolve([]),
    linkedKeys(user.id),
    ownerFor(user.id, statement),
  ]);
  const importedKeys = new Set([...imported.map(t => t.importKey), ...linked]);

  const candidateIndexes = statement.rows
    .map((_, i) => i)
    .filter(i => decisions[i].action === "import" && !importedKeys.has(keys[i]));
  const manualDuplicates = findManualDuplicates(
    candidateIndexes.map(i => {
      const decision = decisions[i] as ImportDecision;
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

  const fresh = rows.filter(r => r.duplicate === null);
  const importable = fresh.filter(r => r.decision.action === "import");
  // Переводы с депозитом учитываем, только если у пользователя заведён счёт накоплений
  const transfers = savings ? fresh.filter(r => r.decision.action === "transfer") : [];
  const bank = BANKS[statement.bank];
  const summary: ImportSummary = {
    bank: statement.bank,
    bankTitle: bank.title,
    accountName: account?.name ?? newAccountName,
    newAccount: account === null,
    owner,
    cardMask: statement.cardMask,
    periodFrom: statement.periodFrom,
    periodTo: statement.periodTo,
    closingBalance: statement.closingBalance,
    total: rows.length,
    toImport: importable.length + transfers.length,
    alreadyImported: rows.filter(r => r.duplicate === "imported").length,
    manualDuplicates: rows.filter(r => r.duplicate === "manual").length,
    skippedOwn: rows.filter(r => r.decision.action === "skip" || (r.decision.action === "transfer" && !savings)).length,
    ownTransfers: fresh.filter(r => r.decision.action === "own").length,
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
      // Для нового счёта — временно основной, настоящий счёт создаётся при импорте
      accountId: account?.id ?? (await getDefaultAccount(user.id)).id,
      bank: statement.bank,
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

type Counterpart = TransferCounterpart & (
  | { type: "tx"; accountId: string; before: Extract<ImportLink, { txId: string }>["before"] }
  | { type: "row"; accountId: string; key: string; batchId: string }
);

/**
 * Парные операции на других своих счетах для строк этой выписки:
 * уже импортированные переводы (расход/доход) и пропущенные «свои» строки других выписок.
 */
async function loadCounterparts(user: ImportUser, accountId: string, rows: StoredRow[], owner: ParsedStatement["owner"], linked: Set<string>): Promise<Counterpart[]> {
  if (rows.length === 0) return [];
  const days = rows.map(r => r.date).sort();
  const range = { gte: startOfDayInstant(addDays(days[0], -4), user.timezone), lt: startOfDayInstant(addDays(days.at(-1)!, 5), user.timezone) };

  const [transactions, batches] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        accountId: { not: accountId },
        scheduledPaymentId: null,
        occurredAt: range,
        OR: [
          { kind: "EXPENSE", category: { key: { in: [...TRANSFER_EXPENSE_KEYS, "cash"] } } },
          { kind: "INCOME", category: { key: { in: TRANSFER_INCOME_KEYS } } },
        ],
      },
      include: { category: { select: { key: true } } },
    }),
    prisma.importBatch.findMany({ where: { userId: user.id, status: "APPLIED", accountId: { not: accountId } }, select: { id: true, accountId: true, rows: true } }),
  ]);

  const fromTransactions: Counterpart[] = transactions.map(t => ({
    type: "tx",
    id: t.id,
    accountId: t.accountId,
    amount: t.kind === "INCOME" ? fromDb(t.amount) : -fromDb(t.amount),
    day: dayKeyOf(t.occurredAt, user.timezone),
    own: mentionsOwner(`${t.note ?? ""} ${t.rawInput ?? ""}`, owner),
    cash: t.category?.key === "cash",
    before: { kind: t.kind, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId },
  }));
  const fromRows: Counterpart[] = batches.flatMap(batch =>
    (batch.rows as unknown as StoredRow[])
      .filter(r => r.decision.action === "own" && r.duplicate === null && !linked.has(r.key))
      .map(r => ({
        type: "row" as const,
        id: `row:${r.key}`,
        key: r.key,
        batchId: batch.id,
        accountId: batch.accountId,
        amount: r.amount,
        day: r.date,
        own: true,
        cash: r.decision.action === "own" && r.decision.note === "Внесение наличных",
      }))
  );
  return [...fromTransactions, ...fromRows];
}

/** Применяет черновик: счёт, категории (выученные → ключевые слова → ИИ), переводы между картами, сверка баланса */
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

  let createdAccountId: string | null = null;
  try {
    let batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    const summary = summaryOf(batch);

    // Новый счёт для карты другого банка
    if (summary.newAccount && summary.accountName) {
      const existing = await prisma.account.findFirst({ where: { userId: user.id, archivedAt: null, name: summary.accountName } });
      const account = existing ?? await prisma.account.create({ data: { userId: user.id, name: summary.accountName, kind: "CARD", inBudget: true } });
      if (!existing) createdAccountId = account.id;
      batch = await prisma.importBatch.update({ where: { id: batch.id }, data: { accountId: account.id } });
    }
    const accountId = batch.accountId;

    const allRows = (batch.rows as unknown as StoredRow[]).filter(r => r.duplicate === null);
    const savings = summary.transfers ? await findSavingsAccount(user.id, accountId) : null;

    await ensureDefaultCategories(user.id);
    const [categories, learned, linked] = await Promise.all([
      prisma.category.findMany({ where: { userId: user.id, archivedAt: null } }),
      prisma.merchantCategory.findMany({ where: { userId: user.id } }),
      linkedKeys(user.id),
    ]);
    const byKey = new Map(categories.filter(c => c.key).map(c => [`${c.kind}:${c.key}`, c.id]));
    const learnedByMerchant = new Map(learned.map(m => [m.merchant, m.categoryId]));

    // ── Переводы между своими картами в разных банках
    const transferish = allRows.filter(r =>
      r.decision.action === "own" ||
      (r.decision.action === "import" && r.decision.kind === "EXPENSE" && TRANSFER_EXPENSE_KEYS.includes(r.decision.categoryKey ?? "")) ||
      (r.decision.action === "import" && r.decision.kind === "INCOME" && TRANSFER_INCOME_KEYS.includes(r.decision.categoryKey ?? ""))
    );
    const counterparts = await loadCounterparts(user, accountId, transferish, summary.owner ?? null, linked);
    const candidates: TransferCandidate[] = transferish.map(r => ({
      amount: r.amount,
      day: r.date,
      own: r.decision.action === "own" || mentionsOwner(noteOf(r.decision), summary.owner ?? null),
      cash: r.decision.action === "own" && r.decision.note === "Внесение наличных",
    }));
    const matches = matchOwnTransfers(candidates, counterparts, daysBetween);
    const pairedKeys = new Set<string>();
    const links: ImportLink[] = [];
    const newLinkedKeys: string[] = [];
    const openingDeltas = new Map<string, number>();
    const linkedTransfers: Prisma.TransactionCreateManyInput[] = [];
    const counterpartUpdates: { id: string; data: Prisma.TransactionUncheckedUpdateInput }[] = [];

    matches.forEach((counterpartId, index) => {
      const row = transferish[index];
      const counterpart = counterparts.find(c => c.id === counterpartId)!;
      const out = row.amount < 0;
      pairedKeys.add(row.key);
      if (counterpart.type === "tx") {
        // Операция другой карты становится переводом между картами, строка этой выписки отдельно не создаётся
        counterpartUpdates.push({
          id: counterpart.id,
          data: out
            ? { kind: "TRANSFER", categoryId: null, accountId, toAccountId: counterpart.accountId }
            : { kind: "TRANSFER", categoryId: null, accountId: counterpart.accountId, toAccountId: accountId },
        });
        links.push({ txId: counterpart.id, before: counterpart.before });
        newLinkedKeys.push(row.key);
      } else {
        // Пропущенная «своя» строка другой выписки: создаём перевод, а баланс того счёта остаётся прежним
        linkedTransfers.push({
          userId: user.id,
          kind: "TRANSFER",
          accountId: out ? accountId : counterpart.accountId,
          toAccountId: out ? counterpart.accountId : accountId,
          categoryId: null,
          amount: toDb(Math.abs(row.amount)),
          occurredAt: localDateTimeToInstant(`${row.date}T12:00`, user.timezone)!,
          note: `Между своими картами: ${noteOf(row.decision)}`.slice(0, 200),
          source: "IMPORT",
          rawInput: row.operation.slice(0, 500),
          importBatchId: batch.id,
          importKey: row.key,
        });
        // Перевод меняет движение по тому счёту — сдвигаем его начальный остаток обратно, чтобы сверенный баланс не изменился
        const delta = out ? Math.abs(row.amount) : -Math.abs(row.amount);
        openingDeltas.set(counterpart.accountId, (openingDeltas.get(counterpart.accountId) ?? 0) - delta);
        newLinkedKeys.push(counterpart.key);
      }
    });

    const rows = allRows.filter(r => r.decision.action === "import" && !pairedKeys.has(r.key));

    // Названия, для которых нет ни выученной категории, ни ключевого слова, — спрашиваем ИИ
    const unknown = [...new Set(
      rows
        .filter(r => r.decision.action === "import" && r.decision.needsAi && !learnedByMerchant.has(normalizeMerchant(r.decision.note)))
        .map(r => normalizeMerchant((r.decision as ImportDecision).note))
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
      const decision = row.decision as ImportDecision;
      const merchant = normalizeMerchant(decision.note);
      const categoryId =
        learnedByMerchant.get(merchant) ??
        (decision.categoryKey ? byKey.get(`${decision.kind}:${decision.categoryKey}`) : undefined) ??
        aiByMerchant.get(merchant) ??
        byKey.get(`${decision.kind}:${FALLBACK_CATEGORY_KEY[decision.kind]}`) ??
        null;
      return {
        userId: user.id,
        accountId,
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
    data.push(...linkedTransfers);

    // Переводы между картой и депозитом — не расход и не доход, а движение между своими счетами
    if (savings) {
      for (const row of allRows) {
        if (row.decision.action !== "transfer") continue;
        const out = row.decision.direction === "out";
        data.push({
          userId: user.id,
          kind: "TRANSFER",
          accountId: out ? accountId : savings.id,
          toAccountId: out ? savings.id : accountId,
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

    const result = await prisma.$transaction(async tx => {
      let created = 0;
      for (let i = 0; i < data.length; i += CREATE_CHUNK) {
        created += (await tx.transaction.createMany({ data: data.slice(i, i + CREATE_CHUNK), skipDuplicates: true })).count;
      }
      for (const update of counterpartUpdates) {
        await tx.transaction.update({ where: { id: update.id }, data: update.data });
      }
      const deltas: ImportLink[] = [];
      for (const [otherAccountId, delta] of openingDeltas) {
        await tx.account.update({ where: { id: otherAccountId }, data: { openingBalance: { increment: toDb(delta) } } });
        deltas.push({ accountId: otherAccountId, openingDelta: delta });
      }

      // Сверка: баланс счёта на конец периода выписки должен совпасть с остатком банка
      const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
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

      const finalSummary: ImportSummary = {
        ...summary,
        imported: created + counterpartUpdates.length,
        linkedTransfers: counterpartUpdates.length + linkedTransfers.length,
        links: [...links, ...deltas],
        linkedKeys: newLinkedKeys,
        createdAccountId,
      };
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: "APPLIED", appliedAt: new Date(), previousOpeningBalance, summary: finalSummary as unknown as Prisma.InputJsonValue },
      });
      return finalSummary;
    }, { timeout: 60_000, maxWait: 10_000 });

    // Переводы между уже загруженными картами (например, «С карты другого банка» в Kaspi и «Перевод» в БЦК).
    // Транзит друзей автоматически не размечается: совпадения круглых сумм часто случайны (см. markAllTransit)
    try {
      const relinked = await relinkOwnTransfers(user, batch.id);
      if (relinked > 0) result.linkedTransfers = (result.linkedTransfers ?? 0) + relinked;
    } catch (error) {
      console.error("Relink transfers failed:", error instanceof Error ? error.message : String(error));
    }

    return { ok: true, summary: result };
  } catch (error) {
    // Счёт, созданный для этого импорта, не должен остаться пустым
    if (createdAccountId) await prisma.account.delete({ where: { id: createdAccountId } }).catch(() => undefined);
    await prisma.importBatch.updateMany({ where: { id: batchId, status: "APPLYING" }, data: { status: "DRAFT" } });
    throw error;
  }
}

/**
 * Связывает уже внесённые из выписок операции разных карт в переводы: расход на одной карте + такое же поступление
 * на другой (см. pairOwnTransfers). Расход становится переводом, поступление удаляется — балансы не меняются.
 * Всё, что изменено, сохраняется в импорт `batchId`, чтобы его отмена вернула операции.
 */
async function relinkOwnTransfers(user: ImportUser, batchId: string) {
  return applyOwnTransferPairs(await findOwnTransferPairs(user), batchId);
}

/** Превращает найденные пары в переводы и записывает откат в импорт `batchId` */
async function applyOwnTransferPairs(pairs: Awaited<ReturnType<typeof findOwnTransferPairs>>, batchId: string) {
  if (pairs.length === 0) return 0;

  await prisma.$transaction(async tx => {
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    const summary = summaryOf(batch);
    const links: ImportLink[] = [...(summary.links ?? [])];
    const keys = [...(summary.linkedKeys ?? [])];
    for (const { out, incoming } of pairs) {
      const t = incoming.tx;
      links.push({ txId: out.id, before: { kind: out.tx.kind, accountId: out.tx.accountId, toAccountId: out.tx.toAccountId, categoryId: out.tx.categoryId } });
      links.push({
        restore: {
          id: t.id, accountId: t.accountId, categoryId: t.categoryId, kind: t.kind, amount: t.amount.toString(), occurredAt: t.occurredAt.toISOString(),
          note: t.note, source: t.source, rawInput: t.rawInput, importBatchId: t.importBatchId, importKey: t.importKey,
        },
      });
      if (t.importKey) keys.push(t.importKey);
      await tx.transaction.update({ where: { id: out.id }, data: { kind: "TRANSFER", categoryId: null, toAccountId: incoming.accountId } });
      await tx.transaction.delete({ where: { id: t.id } });
    }
    await tx.importBatch.update({
      where: { id: batchId },
      data: {
        summary: { ...summary, links, linkedKeys: keys, linkedTransfers: (summary.linkedTransfers ?? 0) + pairs.length } as unknown as Prisma.InputJsonValue,
      },
    });
  }, { timeout: 60_000 });
  return pairs.length;
}

/**
 * Найденные пары переводов между своими картами (без изменений в базе).
 * `minStrength` = 2 — только надёжные пары (владелец, номер или банк другой карты, «карта другого банка»),
 * 1 — плюс обезличенные «Перевод» → «Перевод с карты на карту», которые нужно подтвердить.
 */
export async function findOwnTransferPairs(user: ImportUser, minStrength = 2) {
  const [owners, accounts, transactions] = await Promise.all([
    // Владелец берётся из всех выписок: в одних банках ФИО есть, в других нет
    prisma.importBatch.findMany({ where: { userId: user.id, status: "APPLIED" }, orderBy: { createdAt: "desc" }, select: { summary: true } })
      .then(batches => batches.flatMap(b => summaryOf(b).owner ?? [])),
    prisma.account.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        source: "IMPORT",
        scheduledPaymentId: null,
        notOwnTransfer: false,
        OR: [
          { kind: "EXPENSE", category: { key: { in: TRANSFER_EXPENSE_KEYS } } },
          { kind: "INCOME", category: { key: { in: TRANSFER_INCOME_KEYS } } },
        ],
      },
    }),
  ]);
  const nameOf = (id: string) => accounts.find(a => a.id === id)?.name ?? "";
  const signalFor = (text: string, otherName: string) =>
    owners.length === 0
      ? ownTransferSignal(text, null, otherName)
      : Math.max(...owners.map(owner => ownTransferSignal(text, owner, otherName)));

  const items = transactions.map(t => ({
    id: t.id,
    accountId: t.accountId,
    amount: t.kind === "INCOME" ? fromDb(t.amount) : -fromDb(t.amount),
    day: dayKeyOf(t.occurredAt, user.timezone),
    text: `${t.note ?? ""} ${t.rawInput ?? ""}`,
    tx: t,
  }));
  return pairOwnTransfers(
    items,
    (out, incoming) => Math.max(signalFor(out.text, nameOf(incoming.accountId)), signalFor(incoming.text, nameOf(out.accountId))),
    daysBetween,
    minStrength,
  );
}

export type TransferSuggestion = {
  outId: string;
  incomingId: string;
  amount: number;
  day: string;
  fromAccount: string;
  toAccount: string;
  note: string;
};

/** Похоже на перевод между своими картами, но наверняка знает только пользователь */
export async function listTransferSuggestions(user: ImportUser): Promise<TransferSuggestion[]> {
  const [pairs, accounts] = await Promise.all([
    findOwnTransferPairs(user, 1),
    prisma.account.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
  ]);
  const nameOf = (id: string) => accounts.find(a => a.id === id)?.name ?? "Счёт";
  return pairs
    .filter(pair => pair.strength < 2)
    .map(({ out, incoming }) => ({
      outId: out.id,
      incomingId: incoming.id,
      amount: -out.amount,
      day: out.day,
      fromAccount: nameOf(out.accountId),
      toAccount: nameOf(incoming.accountId),
      note: out.tx.note?.trim() || "Перевод",
    }));
}

/** Пользователь подтвердил пары: расход становится переводом, поступление удаляется */
export async function linkTransferSuggestions(user: ImportUser, outIds: string[]) {
  const wanted = new Set(outIds);
  const pairs = (await findOwnTransferPairs(user, 1)).filter(pair => wanted.has(pair.out.id));
  if (pairs.length === 0) return 0;
  const batch = await createRelinkBatch(user);
  const linked = await applyOwnTransferPairs(pairs, batch.id);
  if (linked === 0) await prisma.importBatch.delete({ where: { id: batch.id } });
  return linked;
}

/** «Это не мои переводы»: больше не предлагать связывать эти операции */
export async function dismissTransferSuggestions(user: ImportUser, ids: string[]) {
  const { count } = await prisma.transaction.updateMany({
    where: { userId: user.id, id: { in: ids } },
    data: { notOwnTransfer: true },
  });
  return count;
}

/** Запись «Связь переводов между картами» — чтобы связывание можно было отменить в настройках */
async function createRelinkBatch(user: ImportUser) {
  const account = await getDefaultAccount(user.id);
  const empty: ImportSummary = {
    bank: "RELINK", bankTitle: "Связь переводов между картами", cardMask: null, periodFrom: null, periodTo: null, closingBalance: null,
    total: 0, toImport: 0, alreadyImported: 0, manualDuplicates: 0, skippedOwn: 0, income: 0, expense: 0, needAi: 0, imported: 0,
  };
  return prisma.importBatch.create({
    data: { userId: user.id, accountId: account.id, bank: "RELINK", status: "APPLIED", appliedAt: new Date(), rows: [], summary: empty as unknown as Prisma.InputJsonValue },
  });
}

/** Разовое связывание переводов по всей истории — отдельной записью, которую можно отменить в настройках */
export async function relinkAllOwnTransfers(user: ImportUser) {
  const batch = await createRelinkBatch(user);
  const linked = await relinkOwnTransfers(user, batch.id);
  if (linked === 0) await prisma.importBatch.delete({ where: { id: batch.id } });
  return linked;
}

/** Пары «друг прислал — отправил дальше» среди переводов (без изменений в базе) */
export async function findTransitPairs(user: ImportUser) {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      OR: [
        { kind: "EXPENSE", category: { key: { in: TRANSFER_EXPENSE_KEYS } } },
        { kind: "INCOME", category: { key: { in: TRANSFER_INCOME_KEYS } } },
      ],
    },
  });
  const items = transactions.map(t => ({
    id: t.id,
    accountId: t.accountId,
    amount: t.kind === "INCOME" ? fromDb(t.amount) : -fromDb(t.amount),
    day: dayKeyOf(t.occurredAt, user.timezone),
    tx: t,
  }));
  return pairTransit(items, daysBetween);
}

/** Переносит найденный транзит в категории «Транзит»; прежние категории сохраняются в импорт `batchId` для отмены */
async function markTransit(user: ImportUser, batchId: string) {
  const pairs = await findTransitPairs(user);
  if (pairs.length === 0) return 0;
  const [transitIn, transitOut] = await Promise.all([
    resolveCategoryId(user.id, "INCOME", "transit_in"),
    resolveCategoryId(user.id, "EXPENSE", "transit_out"),
  ]);
  if (!transitIn || !transitOut) return 0;

  await prisma.$transaction(async tx => {
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    const summary = summaryOf(batch);
    const links: ImportLink[] = [...(summary.links ?? [])];
    for (const { incoming, out } of pairs) {
      for (const [item, categoryId] of [[incoming, transitIn], [out, transitOut]] as const) {
        links.push({ txId: item.id, before: { kind: item.tx.kind, accountId: item.tx.accountId, toAccountId: item.tx.toAccountId, categoryId: item.tx.categoryId } });
        await tx.transaction.update({ where: { id: item.id }, data: { categoryId } });
      }
    }
    await tx.importBatch.update({
      where: { id: batchId },
      data: { summary: { ...summary, links, transitPairs: (summary.transitPairs ?? 0) + pairs.length } as unknown as Prisma.InputJsonValue },
    });
  }, { timeout: 60_000 });
  return pairs.length;
}

/** Разовая разметка транзита по всей истории — отдельной записью, которую можно отменить в настройках */
export async function markAllTransit(user: ImportUser) {
  const account = await getDefaultAccount(user.id);
  const empty: ImportSummary = {
    bank: "TRANSIT", bankTitle: "Транзит друзей", cardMask: null, periodFrom: null, periodTo: null, closingBalance: null,
    total: 0, toImport: 0, alreadyImported: 0, manualDuplicates: 0, skippedOwn: 0, income: 0, expense: 0, needAi: 0, imported: 0,
  };
  const batch = await prisma.importBatch.create({
    data: { userId: user.id, accountId: account.id, bank: "TRANSIT", status: "APPLIED", appliedAt: new Date(), rows: [], summary: empty as unknown as Prisma.InputJsonValue },
  });
  const marked = await markTransit(user, batch.id);
  if (marked === 0) await prisma.importBatch.delete({ where: { id: batch.id } });
  return marked;
}

/** Отмена: черновик просто закрывается, применённый импорт удаляет свои операции, возвращает связанные переводы и баланс */
export async function cancelImport(user: ImportUser, batchId: string) {
  return prisma.$transaction(async tx => {
    const batch = await tx.importBatch.findFirst({ where: { id: batchId, userId: user.id } });
    if (!batch || batch.status === "CANCELLED" || batch.status === "APPLYING") return null;

    let removed = 0;
    if (batch.status === "APPLIED") {
      const summary = summaryOf(batch);
      for (const link of summary.links ?? []) {
        if ("txId" in link) {
          await tx.transaction.updateMany({ where: { id: link.txId, userId: user.id }, data: link.before });
        } else if ("restore" in link) {
          const r = link.restore;
          await tx.transaction.create({
            data: {
              id: r.id!, userId: user.id, accountId: r.accountId!, categoryId: r.categoryId, kind: r.kind!, amount: BigInt(r.amount!),
              occurredAt: new Date(r.occurredAt!), note: r.note, source: r.source!, rawInput: r.rawInput, importBatchId: r.importBatchId, importKey: r.importKey,
            },
          }).catch(() => undefined);
        } else {
          await tx.account.updateMany({ where: { id: link.accountId, userId: user.id }, data: { openingBalance: { decrement: toDb(link.openingDelta) } } });
        }
      }
      removed = (await tx.transaction.deleteMany({ where: { importBatchId: batch.id, userId: user.id } })).count;
      if (batch.previousOpeningBalance !== null) {
        await tx.account.updateMany({
          where: { id: batch.accountId, userId: user.id },
          data: { openingBalance: batch.previousOpeningBalance },
        });
      }
      // Счёт, который создал этот импорт, убираем, если на нём больше ничего нет
      if (summary.createdAccountId) {
        const [left, incoming] = await Promise.all([
          tx.transaction.count({ where: { accountId: summary.createdAccountId } }),
          tx.transaction.count({ where: { toAccountId: summary.createdAccountId } }),
        ]);
        if (left + incoming === 0) await tx.account.deleteMany({ where: { id: summary.createdAccountId, userId: user.id } });
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

/** Когда пользователь меняет категорию расхода — запоминаем магазин или описание («сигареты» → «Табак») */
export async function rememberMerchantCategory(userId: string, transactionId: string, categoryId: string | null) {
  if (!categoryId) return;
  const tx = await prisma.transaction.findFirst({ where: { id: transactionId, userId, kind: "EXPENSE" } });
  if (!tx?.note) return;
  const merchant = normalizeMerchant(tx.note.replace(/^Возврат:\s*/, ""));
  await prisma.merchantCategory.upsert({
    where: { userId_merchant: { userId, merchant } },
    create: { userId, merchant, categoryId },
    update: { categoryId },
  });
}

/** Убирает запись об отменённом импорте из списка (операции уже удалены при отмене) */
export async function forgetImport(userId: string, batchId: string) {
  const { count } = await prisma.importBatch.deleteMany({ where: { id: batchId, userId, status: "CANCELLED" } });
  return count > 0;
}

export async function listImports(userId: string) {
  const batches = await prisma.importBatch.findMany({
    where: { userId, status: { in: ["APPLIED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, bank: true, periodFrom: true, periodTo: true, summary: true, appliedAt: true, cancelledAt: true },
  });
  return batches.map(b => ({
    id: b.id,
    status: b.status as "APPLIED" | "CANCELLED",
    bankTitle: b.bank === "RELINK" ? "Связь переводов между картами" : b.bank === "TRANSIT" ? "Транзит друзей" : BANKS[b.bank as BankCode]?.title ?? b.bank,
    periodFrom: b.periodFrom,
    periodTo: b.periodTo,
    imported: summaryOf(b).imported ?? 0,
  }));
}
