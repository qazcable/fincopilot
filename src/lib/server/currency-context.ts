import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { setCurrencyResolver } from "@/lib/domain/money";
import { currencyCode, type CurrencyCode } from "@/lib/domain/currency";

// Валюта пользователя для formatMoney на сервере:
// бот, крон и API оборачивают обработку в runWithCurrency; страницы берут её из данных запроса (getCurrentUser)
const store = new AsyncLocalStorage<CurrencyCode>();

const requestCurrency = cache((): { code: CurrencyCode | null } => ({ code: null }));

function fromRequest() {
  try {
    return requestCurrency().code;
  } catch {
    return null;
  }
}

setCurrencyResolver(() => store.getStore() ?? fromRequest());

export function runWithCurrency<T>(currency: string | null | undefined, fn: () => T): T {
  return store.run(currencyCode(currency), fn);
}

export function setRequestCurrency(currency: string | null | undefined) {
  try {
    requestCurrency().code = currencyCode(currency);
  } catch {
    // Вне рендера React кэша запроса нет — валюту задаёт runWithCurrency
  }
}
