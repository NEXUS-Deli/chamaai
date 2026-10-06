import type { ElementType, ReactNode } from "react";

const COLS: Record<2 | 3 | 4 | 5, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1",
};

/** Grade de painéis unidos (divisória de 1px), no mesmo visual das métricas do Dashboard. */
export function MetricGrid({ cols = 4, children }: { cols?: 2 | 3 | 4 | 5; children: ReactNode }) {
  return (
    <div className={`grid ${COLS[cols]} gap-px bg-border rounded-xl overflow-hidden border`}>
      {children}
    </div>
  );
}

export function Metric({
  label, value, icon: Icon, note, tone,
}: {
  label: string;
  value: string | number;
  icon: ElementType;
  note?: string;
  /** Destaque do número: "brand" (verde) ou "danger" (vermelho). */
  tone?: "brand" | "danger";
}) {
  const toneClass = tone === "brand" ? "text-brand" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="bg-card px-5 py-4 flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
        <p className={`text-xl font-bold tracking-tight ${toneClass}`}>{value}</p>
        {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
      </div>
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
    </div>
  );
}
