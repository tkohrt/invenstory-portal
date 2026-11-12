// Tab pills for merged admin pages (patch 36): the Funding switch pattern,
// generalized. Plain links, so the server decides what loads per tab and the
// browser's back button works.
export default function AdminTabs({ tabs, active }: {
  tabs: { key: string; href: string; label: string; badge?: number }[];
  active: string;
}) {
  return (
    <div role="group" aria-label="Sections" className="adm-tabs">
      {tabs.map(t => (
        <a key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}
           className={t.key === active ? "on" : ""}>
          {t.label}
          {(t.badge ?? 0) > 0 && <span className="badge-count">{t.badge}</span>}
        </a>
      ))}
    </div>
  );
}
