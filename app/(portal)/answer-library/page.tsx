import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getFeatureVisible, getTenant } from "@/lib/server/data";

export default async function AnswerLibraryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const tenant = await getTenant(session.tenantId);
  if (!tenant) redirect("/");
  const isAdmin = session.role === "admin";
  // Hidden by default; clients can only reach it once an admin turns it on.
  if (!isAdmin) {
    const visible = await getFeatureVisible(session.tenantId, "answer_library");
    if (!visible) redirect("/dashboard");
  }

  const categories = [
    "Organization overview & mission",
    "Statement of need",
    "Who you serve & geography",
    "Program / product description",
    "Goals & measurable objectives",
    "Outcomes, impact & evaluation",
    "Leadership, team & capacity",
    "Financial overview & budget",
    "Sustainability & future funding",
    "Amount requested & use of funds",
  ];

  return (
    <div>
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · viewing {tenant.name}</div>}
      <div className="page-head">
        <div>
          <h2>Answer Library</h2>
          <p>
            Most grant applications ask variations of the same core questions. Answer them
            well once here — drawing on your Inven(s)tory — and every future application starts
            from a high-quality, pre-written draft instead of a blank page. We auto-generate a
            first pass from your documents, flag what&apos;s strong, thin, or missing, and keep
            your answers fresh as you add new materials.
          </p>
        </div>
      </div>

      <div className="al-intro-grid">
        <div className="al-step"><span className="al-step-n">1</span><div><strong>Auto-drafted</strong><p>We pre-fill answers from your Inven(s)tory and cite the source documents.</p></div></div>
        <div className="al-step"><span className="al-step-n">2</span><div><strong>You review</strong><p>Confirm, edit, or strengthen each answer. Human-reviewed answers count toward your completeness score.</p></div></div>
        <div className="al-step"><span className="al-step-n">3</span><div><strong>Assemble faster</strong><p>New grant drafts pull directly from your answered questions — no more re-writing the basics.</p></div></div>
      </div>

      <div className="al-soon">
        <div className="section-label">Question set — coming soon to your account</div>
        <p className="al-soon-lede">
          The For Granted team is preparing your personalized question set, ranked by what
          funders in your space ask most. You&apos;ll see these questions here, each with a draft
          answer and a completeness flag:
        </p>
        <ul className="al-cat-list">
          {categories.map(c => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </div>
  );
}
