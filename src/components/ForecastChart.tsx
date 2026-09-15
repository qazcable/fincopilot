"use client";

import { useId, useMemo, useState } from "react";
import clsx from "clsx";
import type { ForecastDay } from "@/lib/domain/forecast";
import { formatDayKey, weekdayOf } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { haptic } from "@/lib/client/telegram";

const W = 360;
const H = 190;
const PAD = { top: 16, right: 12, bottom: 24, left: 12 };

/** Сокращение для подписей оси: 185 тыс., 1,2 млн */
function compact(minor: number) {
  const value = minor / 100;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} млн`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)} тыс.`;
  return String(Math.round(value));
}

export function ForecastChart({ points, today, gapStart }: { points: ForecastDay[]; today: string; gapStart: string | null }) {
  const clipId = useId();
  const [active, setActive] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const values = points.map(p => p.balance);
    const max = Math.max(0, ...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const x = (i: number) => PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + ((max - v) / span) * (H - PAD.top - PAD.bottom);
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
    const zero = y(0);
    const area = `${line} L${x(points.length - 1).toFixed(1)},${zero.toFixed(1)} L${x(0).toFixed(1)},${zero.toFixed(1)} Z`;
    // Подписи дат: начало, каждые ~2 недели
    const last = points.length - 1;
    const ticks = points.map((p, i) => ({ i, day: p.day })).filter(t => (t.i % 14 === 0 && last - t.i >= 8) || t.i === last);
    return { x, y, line, area, zero, max, min, ticks };
  }, [points]);

  const point = active !== null ? points[active] : null;

  function pick(clientX: number, target: SVGSVGElement) {
    const rect = target.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const svgX = ratio * W;
    const index = Math.round(((svgX - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
    const next = Math.min(points.length - 1, Math.max(0, index));
    if (next !== active) {
      if (points[next].events.length > 0) haptic.select();
      setActive(next);
    }
  }

  return (
    <div className="relative">
      {/* Подсказка над графиком — всегда видна и не перекрывает линию */}
      <div className="mb-2 flex min-h-[44px] items-end justify-between gap-3 px-1">
        {point ? (
          <>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-muted">{formatDayKey(point.day, today)}, {weekdayOf(point.day)}</p>
              <p className="truncate text-[12px] text-muted">
                {point.events.length > 0 ? point.events.map(e => `${e.title} ${formatMoney(e.amount, { sign: true })}`).join(" · ") : "Обычные траты"}
              </p>
            </div>
            <p className={clsx("shrink-0 text-[18px] font-bold tabular", point.balance < 0 ? "text-negative" : "text-fg")}>{formatMoney(point.balance)}</p>
          </>
        ) : (
          <p className="text-[12px] text-faint">Проведите по графику, чтобы увидеть остаток на любой день</p>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-none select-none"
        role="img"
        aria-label={gapStart ? `Прогноз остатка: разрыв с ${formatDayKey(gapStart)}` : "Прогноз остатка без кассовых разрывов"}
        onPointerMove={e => pick(e.clientX, e.currentTarget)}
        onPointerDown={e => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <clipPath id={`${clipId}-above`}><rect x="0" y="0" width={W} height={Math.max(0, geometry.zero)} /></clipPath>
          <clipPath id={`${clipId}-below`}><rect x="0" y={geometry.zero} width={W} height={Math.max(0, H - geometry.zero)} /></clipPath>
        </defs>

        {/* Нулевая линия */}
        <line x1={PAD.left} x2={W - PAD.right} y1={geometry.zero} y2={geometry.zero} stroke="var(--faint)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={W - PAD.right} y={geometry.zero - 4} textAnchor="end" fontSize="9" fill="var(--faint)">0 ₸</text>
        {geometry.max > 0 && <text x={PAD.left} y={PAD.top - 5} fontSize="9" fill="var(--faint)">{compact(geometry.max)}</text>}

        {/* Выше нуля — цвет приложения, ниже — дефицит */}
        <g clipPath={`url(#${clipId}-above)`}>
          <path d={geometry.area} fill="var(--accent)" opacity="0.12" />
          <path d={geometry.line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </g>
        <g clipPath={`url(#${clipId}-below)`}>
          <path d={geometry.area} fill="var(--negative)" opacity="0.16" />
          <path d={geometry.line} fill="none" stroke="var(--negative)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </g>

        {/* Доходы и платежи */}
        {points.map((p, i) => p.events.length === 0 ? null : (
          <circle
            key={p.day}
            cx={geometry.x(i)}
            cy={geometry.y(p.balance)}
            r="4"
            fill={p.events.some(e => e.kind === "income") ? "var(--positive)" : "var(--warning)"}
            stroke="var(--surface)"
            strokeWidth="2"
          />
        ))}

        {geometry.ticks.map(t => (
          <text key={t.day} x={geometry.x(t.i)} y={H - 6} fontSize="9" fill="var(--faint)" textAnchor={t.i === 0 ? "start" : t.i === points.length - 1 ? "end" : "middle"}>
            {t.i === 0 ? "сегодня" : formatDayKey(t.day)}
          </text>
        ))}

        {point && active !== null && (
          <g pointerEvents="none">
            <line x1={geometry.x(active)} x2={geometry.x(active)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth="1" />
            <circle cx={geometry.x(active)} cy={geometry.y(point.balance)} r="5" fill={point.balance < 0 ? "var(--negative)" : "var(--accent)"} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-positive" aria-hidden /> доход</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warning" aria-hidden /> платёж</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-negative" aria-hidden /> ниже нуля</span>
      </div>
    </div>
  );
}
