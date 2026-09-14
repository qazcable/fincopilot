/** Кольцевая диаграмма на SVG без внешних библиотек */
export function Donut({
  segments,
  size = 184,
  thickness = 22,
  children,
}: { segments: { value: number; color: string }[]; size?: number; thickness?: number; children?: React.ReactNode }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = segments.length > 1 ? 3 : 0;

  let offset = 0;
  const arcs = total > 0
    ? segments.map(segment => {
        const length = (segment.value / total) * circumference;
        const arc = { color: segment.color, dash: Math.max(0.01, length - gap), offset };
        offset += length;
        return arc;
      })
    : [];

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
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
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
