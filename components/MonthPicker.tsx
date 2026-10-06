"use client";
// The month an admin activity view shows, Eastern time. Kept in the address
// (?m=YYYY-MM) so a month can be linked and reloaded.
import { useRouter, usePathname } from "next/navigation";
import { monthLabel } from "@/lib/activity";

export default function MonthPicker({ month, months }: { month: string; months: string[] }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <label className="mp">
      <span className="ov-muted">Month</span>
      <select value={month} onChange={e => router.push(`${path}?m=${e.target.value}`)}>
        {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
    </label>
  );
}
