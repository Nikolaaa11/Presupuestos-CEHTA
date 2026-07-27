"use client";

import { usePathname, useRouter } from "next/navigation";

export function CompanySelector({
  companies,
  selectedCode,
}: {
  companies: { code: string; name: string }[];
  selectedCode: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex items-center gap-2 text-sm text-ink-soft">
      Empresa
      <select
        value={selectedCode}
        onChange={(event) => router.push(`${pathname}?empresa=${encodeURIComponent(event.target.value)}`)}
        className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand"
      >
        {companies.map((company) => (
          <option key={company.code} value={company.code}>
            {company.code} · {company.name}
          </option>
        ))}
      </select>
    </label>
  );
}
