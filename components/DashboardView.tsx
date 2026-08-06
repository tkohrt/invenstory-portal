import type { ClientStats, PortfolioStats } from "@/lib/types";

const money = (cents: number) => "$" + Math.round(cents / 100).toLocaleString();
const num = (n: number) => n.toLocaleString();

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`stat-card${accent ? " accent" : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function DashboardView(props:
  | { role: "client"; orgName: string; stats: ClientStats }
  | { role: "admin"; portfolio: PortfolioStats }) {

  if (props.role === "client") {
    const s = props.stats;
    return (
      <div>
        <div className="page-head"><div><h2>{props.orgName}</h2><p>Your Inven(s)tory at a glance.</p></div></div>

        <div className="section-label">Your story, captured</div>
        <div className="stat-grid">
          <Stat label="Documents" value={num(s.docs)} sub={`Layer I ${s.byLayer.I} · II ${s.byLayer.II} · III ${s.byLayer.III}`} />
          <Stat label="Words captured" value={num(s.words)} />
        </div>

        <div className="section-label" style={{ marginTop: 22 }}>Grant outcomes</div>
        <div className="stat-grid">
          <Stat label="Grant revenue won" value={money(s.revenueWonCents)} accent />
          <Stat label="Grants won" value={num(s.won)} />
          <Stat label="Applications submitted" value={num(s.applied)} />
          <Stat label="In progress" value={num(s.inProgress)} />
        </div>

        <div className="section-label" style={{ marginTop: 22 }}>Coming soon</div>
        <div className="stat-grid">
          <Stat label="Funders matched" value="—" sub="Arrives with funder matching" />
          <Stat label="Standard questions answered" value="—" sub="Arrives with the Answer Library" />
        </div>
      </div>
    );
  }

  const p = props.portfolio;
  const cut = (r: number) => money(Math.round(r * 0.10)) + "–" + money(Math.round(r * 0.15));
  return (
    <div>
      <div className="page-head"><div><h2>Portfolio overview</h2><p>Across every For Granted client.</p></div></div>
      <div className="stat-grid">
        <Stat label="Grant revenue won" value={money(p.revenueWonCents)} sub={`For Granted share (10–15%): ${cut(p.revenueWonCents)}`} accent />
        <Stat label="Clients" value={num(p.tenants)} />
        <Stat label="Grants won" value={num(p.won)} />
        <Stat label="Applications submitted" value={num(p.applied)} />
        <Stat label="Documents" value={num(p.totalDocs)} />
        <Stat label="Words captured" value={num(p.totalWords)} />
      </div>

      <div className="section-label" style={{ marginTop: 22 }}>By client</div>
      <div className="portfolio-table">
        <div className="pt-row pt-head"><div>Client</div><div>Docs</div><div>Grants won</div><div>Revenue won</div></div>
        {p.perClient.map(c => (
          <div key={c.name} className="pt-row">
            <div>{c.name}</div><div>{num(c.docs)}</div><div>{num(c.won)}</div><div>{money(c.revenueWonCents)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
