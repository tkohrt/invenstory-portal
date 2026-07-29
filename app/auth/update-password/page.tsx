import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { updatePasswordAction } from "@/lib/server/actions";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/");
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand"><div className="logo">i</div><h1>Set a new password</h1></div>
        <p className="sub">For {session.user.email}</p>
        <form action={updatePasswordAction}>
          <label>New password (12+ characters)</label>
          <input name="password" type="password" minLength={12} autoComplete="new-password" required />
          {error && <div className="metric-gap" style={{ marginTop: 10 }}><b>Problem:</b> {error}</div>}
          <button className="btn" type="submit">Save password</button>
        </form>
      </div>
    </div>
  );
}
