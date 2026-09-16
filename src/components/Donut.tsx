"use client";

import { useRouter } from "next/navigation";
import { haptic } from "@/lib/client/telegram";

export type DonutSegment = { value: number; color: string; label?: string; href?: string };

/** Кольцевая диаграмма на SVG без внешних библиотек. Сегмент со ссылкой открывает детали категории */
export function Donut({
  segments,
  size = 184,
  thickness = 22,
  children,
}: { segments: DonutSegment[]; size?: number; thickness?: number; children?: React.ReactNode }) {
  const router = useRouter();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = segments.length > 1 ? 3 : 0;

  let offset = 0;
  const arcs = total > 0
    ? segments.map(segment => {
        const length = (segment.value / total) * circumference;
        const arc = { ...segment, dash: Math.max(0.01, length - gap), offset };
        offset += length;
        return arc;
      })
    : [];

  function open(href: string) {
    haptic.tap();
    router.push(href);
  }

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        {arcs.map((arc, index) => (
          <circle
            key={index}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={thickness}
            strokeLinecap={segments.length > 1 ? "butt" : "round"}
            strokeDasharray={`${arc.dash} ${circumference}`}
            strokeDashoffset={-arc.offset}
            onClick={arc.href ? () => open(arc.href!) : undefined}
            className={arc.href ? "cursor-pointer transition-opacity active:opacity-70" : undefined}
          >
            {arc.label && <title>{arc.label}</title>}
          </circle>
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
