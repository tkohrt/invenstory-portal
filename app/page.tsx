import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { signInAction } from "@/lib/server/actions";
import LoginRoleToggle from "@/components/LoginRoleToggle";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/library");
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand"><div className="logo">i</div><h1>Inven(s)tory Portal</h1></div>
        <p className="sub">Find your story. Fund your mission.</p>
        <form action={signInAction}>
          <label>Email</label>
          <input name="email" defaultValue="lili@fundtheclimb.org" autoComplete="email" />
          <label>Password</label>
          <input name="password" type="password" defaultValue="········" autoComplete="current-password" />
          <LoginRoleToggle />
          <button className="btn" type="submit">Sign in</button>
        </form>
        <div className="hint">Phase 3a — live database, mock identity (real authentication lands in Phase 4).</div>
      </div>
    </div>
  );
}
