// For Granted's view of chat answers a client sent back (patch 16, onboarding
// build, 3 Nov 2026): suggested Story Cards, and answers marked Not right.
import type { ChatFeedbackItem } from "@/lib/server/portal-guide";

export default function AdminChatFeedback({ items }: { items: ChatFeedbackItem[] }) {
  if (!items.length) return null;
  const cards = items.filter(i => i.action === "chat_card_suggestion");
  const wrong = items.filter(i => i.action === "chat_not_right");
  const when = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <section className="card su-admin" aria-label="Chat answers sent back">
      <h3>Chat answers sent back</h3>
      {cards.length > 0 && <>
        <h4>Suggested as Story Cards</h4>
        <p className="su-small">Make the card from the cited documents, so it traces to its source.</p>
        <ul className="su-list">{cards.map(c => (
          <li key={c.id}><b>{c.by ?? "Someone"}, {when(c.at)}:</b> {c.a}{c.sources.length > 0 && <span className="su-small"> (from {c.sources.join(", ")})</span>}</li>
        ))}</ul>
      </>}
      {wrong.length > 0 && <>
        <h4>Marked Not right</h4>
        <ul className="su-list">{wrong.map(c => (
          <li key={c.id}><b>{c.lane === "guide" ? "Portal Guide" : "Inven(s)tory"}, {c.by ?? "someone"}, {when(c.at)}:</b> asked &ldquo;{c.q}&rdquo;; answer began &ldquo;{c.a.slice(0, 160)}{c.a.length > 160 ? "…" : ""}&rdquo;</li>
        ))}</ul>
      </>}
    </section>
  );
}
