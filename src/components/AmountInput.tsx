"use client";

import clsx from "clsx";
import { Delete } from "lucide-react";
import { formatMoney, MAX_AMOUNT_MINOR } from "@/lib/domain/money";
import { haptic } from "@/lib/client/telegram";

/** Сумма как строка ввода: "1250", "1250,5". Хранится без разделителей тысяч. */
export function inputToMinor(value: string) {
  if (!value) return 0;
  const [whole, fraction = ""] = value.split(",");
  return Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export function minorToAmountInput(minor: number) {
  if (!minor) return "";
  const whole = Math.floor(minor / 100);
  const fraction = minor % 100;
  return fraction ? `${whole},${String(fraction).padStart(2, "0").replace(/0$/, "")}` : String(whole);
}

function pressKey(value: string, key: string) {
  if (key === "back") return value.slice(0, -1);
  if (key === ",") return value.includes(",") ? value : `${value || "0"},`;
  const [whole, fraction] = value.split(",");
  if (fraction !== undefined && fraction.length >= 2) return value;
  if (fraction === undefined && whole === "0") return key === "0" ? value : key;
  const next = value + key;
  return inputToMinor(next) > MAX_AMOUNT_MINOR || (fraction === undefined && whole.length >= 12) ? value : next;
}

export function AmountDisplay({ value, tone }: { value: string; tone: "EXPENSE" | "INCOME" }) {
  const minor = inputToMinor(value);
  const [whole, fraction] = value.split(",");
  const wholeText = formatMoney(Number(whole || "0") * 100, { currency: false });
  const size = wholeText.length > 11 ? "text-[36px]" : wholeText.length > 8 ? "text-[44px]" : "text-[54px]";

  return (
    <div className="flex h-20 items-center justify-center" aria-live="polite">
      <span className={clsx("tabular font-bold tracking-tight transition-colors", size, minor ? (tone === "INCOME" ? "text-positive" : "text-fg") : "text-faint")}>
        {tone === "INCOME" && minor ? "+" : ""}
        {wholeText}
        {fraction !== undefined && <span>,{fraction}</span>}
        <span className="ml-2 text-[0.6em] text-faint">₸</span>
      </span>
    </div>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "back"];

export function Keypad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map(key => (
        <button
          key={key}
          type="button"
          aria-label={key === "back" ? "Стереть" : key}
          onClick={() => { haptic.select(); onChange(pressKey(value, key)); }}
          className="pressable flex h-[52px] items-center justify-center rounded-2xl bg-surface-2 text-[22px] font-semibold active:bg-surface-3"
        >
          {key === "back" ? <Delete className="size-6 text-muted" /> : key}
        </button>
      ))}
    </div>
  );
}
