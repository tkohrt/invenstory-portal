"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { getPendingReviews, getTenant, getTenants } from "@/lib/data";

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, role, tenantId, signOut, switchTenant } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => { if (!user) router.replace("/"); }, [user, router]);
  useEffect(() => { setNavOpen(false); }, [path]);
  if (!user || !tenantId) return null;

  const admin = role === "admin";
  const pending = admin ? getPendingReviews().length : 0;
  const initials = user.full_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const nav = (href: string) => `nav-item${path.startsWith(href) ? " active" : ""}`;

  return (
    <div className="shell">
      <div className="topbar">
        <button className="menu-toggle" onClick={() => setNavOpen(o => !o)} aria-label="Menu">☰</button>
        <div className="brand"><div className="logo">i</div><h1>Inven(s)tory Portal</h1></div>
        <div className="spacer" />
        <div className="userchip">
          <div className="meta">
            <div className="name">{user.full_name}</div>
            <div className="role">{admin ? "For Granted · Admin" : getTenant(tenantId)?.name}</div>
          </div>
          <div className="avatar">{initials}</div>
          <button className="btn ghost" onClick={() => { signOut(); router.push("/"); }}>Sign out</button>
        </div>
      </div>
      <div className={`sidebar${navOpen ? " open" : ""}`}>
        {admin && (
          <div>
            <div className="admin-flag">ADMIN VIEW</div>
            <div className="client-switch">
              <label style={{ marginTop: 0 }}>Viewing client</label>
              <select value={tenantId} onChange={e => switchTenant(e.target.value)}>
                {getTenants().map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="nav-section-label">Workspace</div>
        <Link className={nav("/library")} href="/library"><span className="ic">▦</span> Library</Link>
        <Link className={nav("/search")} href="/search"><span className="ic">⌕</span> Search</Link>
        <Link className={nav("/chat")} href="/chat"><span className="ic">✦</span> Ask AI</Link>
        {admin && (
          <div>
            <div className="nav-section-label" style={{ marginTop: 16 }}>Admin</div>
            <Link className={nav("/admin/clients")} href="/admin/clients"><span className="ic">◫</span> All clients</Link>
            <Link className={nav("/admin/reviews")} href="/admin/reviews">
              <span className="ic">✦</span> Artifact reviews
              {pending > 0 && <span className="badge-count">{pending}</span>}
            </Link>
          </div>
        )}
      </div>
      <div className="main">{children}</div>
    </div>
  );
}
