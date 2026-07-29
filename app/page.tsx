import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { signInAction, requestPasswordResetAction } from "@/lib/server/actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const session = await getSession();
  if (session) redirect("/library");
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand"><div className="logo">i</div><h1>Inven(s)tory Portal</h1></div>
        <p className="sub">Find your story. Fund your mission.</p>
        <form action={signInAction}>
          <label>Email</label>
          <input name="email" type="email" required autoComplete="email" />
          <label>Password</label>
          <input name="password" type="password" required autoComplete="current-password" />
          {error && <div className="metric-gap" style={{ marginTop: 12 }}><b>Problem:</b> {error}</div>}
          {notice && <div className="gap-note" style={{ marginTop: 12 }}>{notice}</div>}
          <button className="btn" type="submit">Sign in</button>
        </form>
        <form action={requestPasswordResetAction}>
          <label style={{ marginTop: 18 }}>Forgot your password?</label>
          <div className="tag-input-row">
            <input name="email" type="email" placeholder="Your email" autoComplete="email" />
            <button className="btn secondary" type="submit">Send reset link</button>
          </div>
        </form>
        <div className="hint">Access is by For Granted invitation.</div>
      </div>
    </div>
  );
}
