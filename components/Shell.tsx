"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOutAction, switchTenantAction } from "@/lib/server/actions";
import { setArtifactVisibilityAction } from "@/lib/server/artifact-actions";
import type { AppUser, NavArtifact, Tenant } from "@/lib/types";

export interface ShellProps {
  user: AppUser; role: "client" | "admin"; tenantId: string;
  tenants: Tenant[]; artifactTypes: NavArtifact[]; pendingCount: number;
  children?: React.ReactNode;
}

export default function Shell({ user, role, tenantId, tenants, artifactTypes, pendingCount, children }: ShellProps) {
  const path = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [topQuery, setTopQuery] = useState("");
  const submitSearch = (e: React.FormEvent) => { e.preventDefault(); const v = topQuery.trim(); if (v) router.push(`/search?q=${encodeURIComponent(v)}`); };
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null);
  const admin = role === "admin";
  const toggleVisibility = async (e: React.MouseEvent, slug: string, currentlyVisible: boolean) => {
    e.preventDefault(); e.stopPropagation();
    setTogglingSlug(slug);
    await setArtifactVisibilityAction(slug, !currentlyVisible);
    setTogglingSlug(null);
    router.refresh();
  };
  const initials = user.full_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const tenantName = tenants.find(t => t.id === tenantId)?.name ?? "";
  const nav = (href: string) => `nav-item${path.startsWith(href) ? " active" : ""}`;
  const closeNav = () => setNavOpen(false);

  return (
    <div className="shell">
      <div className="topbar">
        <button className="menu-toggle" onClick={() => setNavOpen(o => !o)} aria-label="Menu">☰</button>
        <div className="brand"><div className="logo">i</div><h1>Inven(s)tory Portal</h1></div>
        <form className="topbar-search" onSubmit={submitSearch}>
          <span className="ts-icon">⌕</span>
          <input value={topQuery} onChange={e => setTopQuery(e.target.value)} placeholder="Search this Inven(s)tory…" aria-label="Search" />
        </form>
        <div className="userchip">
          <Link href="/account" className="userchip-link" onClick={closeNav}>
            <div className="meta">
              <div className="name">{user.full_name}</div>
              <div className="role">{admin ? "For Granted · Admin" : tenantName}</div>
            </div>
            <div className="avatar">{initials}</div>
          </Link>
          <button className="btn ghost" onClick={() => signOutAction()}>Sign out</button>
        </div>
      </div>
      <div className={`sidebar${navOpen ? " open" : ""}`}>
        {admin && (
          <div>
            <div className="admin-flag">ADMIN VIEW</div>
            <div className="client-switch">
              <label style={{ marginTop: 0 }}>Viewing client</label>
              <select value={tenantId} onChange={async e => { await switchTenantAction(e.target.value); router.refresh(); }}>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="nav-section-label">Workspace</div>
        <Link onClick={closeNav} className={nav("/dashboard")} href="/dashboard"><span className="ic">▤</span> Dashboard</Link>
        <Link onClick={closeNav} className={nav("/library")} href="/library"><span className="ic">▦</span> Library</Link>
        <Link onClick={closeNav} className={nav("/chat")} href="/chat"><span className="ic">✦</span> Ask your Inven(s)tory</Link>
        <Link onClick={closeNav} className={nav("/account")} href="/account"><span className="ic">◔</span> Account</Link>
        <Link onClick={closeNav} className={nav("/drafts")} href="/drafts"><span className="ic">✎</span> Grants In The Works</Link>
        <div className="nav-section-label" style={{ marginTop: 16 }}>Story Intelligence</div>
        {artifactTypes.map(t => (
          <Link key={t.slug} onClick={closeNav}
            className={`${nav(`/story-intelligence/${t.slug}`)}${admin && !t.visible ? " nav-hidden" : ""}`}
            href={`/story-intelligence/${t.slug}`}
            title={admin ? (t.visible ? "Visible to client" : "Hidden from client") : undefined}>
            <span className="ic">◈</span> {t.nav_label}
            {admin && (
              <button type="button"
                className={`vis-dot ${t.visible ? "on" : "off"}${togglingSlug === t.slug ? " busy" : ""}`}
                onClick={e => toggleVisibility(e, t.slug, t.visible)}
                aria-label={t.visible ? "Hide from client" : "Show to client"}
                title={t.visible ? "Visible to client — click to hide" : "Hidden from client — click to show"} />
            )}
          </Link>
        ))}
        {admin && (
          <div>
            <div className="nav-section-label" style={{ marginTop: 16 }}>Admin</div>
            <Link onClick={closeNav} className={nav("/admin/clients")} href="/admin/clients"><span className="ic">◫</span> All clients</Link>
            <Link onClick={closeNav} className={nav("/admin/reviews")} href="/admin/reviews">
              <span className="ic">✦</span> Story Intelligence reviews
              {pendingCount > 0 && <span className="badge-count">{pendingCount}</span>}
            </Link>
          </div>
        )}
      </div>
      <div className="main">{children}</div>
    </div>
  );
}
