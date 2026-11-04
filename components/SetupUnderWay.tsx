// What a teammate sees while the first person is still doing the company
// setup (patch 14, onboarding build, 3 November 2026).
export default function SetupUnderWay({ by, done, total }: { by: string | null; done: number; total: number }) {
  return (
    <div className="su-wait" role="status">
      <b>{by ?? "Someone on your team"} is setting up your organization ({done} of {total} steps done).</b>
      <span>You can look around in the meantime. Pages fill in as documents are read; nothing here needs you yet.</span>
    </div>
  );
}
