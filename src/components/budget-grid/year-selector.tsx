"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Selector de año presupuestario; conserva el resto de los parámetros (?empresa=). */
export function YearSelector({ years, selected }: { years: number[]; selected: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (years.length <= 1) {
    return <span className="text-sm text-ink-soft">Año <strong className="text-ink">{selected}</strong></span>;
  }

  return (
    <label className="flex items-center gap-2 text-sm text-ink-soft">
      Año
      <select
        value={selected}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("año", event.target.value);
          router.push(`${pathname}?${params.toString()}`);
        }}
        className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand"
      >
        {years.map((year) => (
          <option key={year} value={year}>{year}</option>
        ))}
      </select>
    </label>
  );
}
