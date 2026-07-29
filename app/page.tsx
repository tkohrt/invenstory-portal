"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/types";

export default function LoginPage() {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("lili@fundtheclimb.org");
  const [role, setRole] = useState<Role>("client");
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand"><div className="logo">i</div><h1>Inven(s)tory Portal</h1></div>
        <p className="sub">Find your story. Fund your mission.</p>
        <label>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
        <label>Password</label>
        <input type="password" defaultValue="········" autoComplete="current-password" />
        <label>Sign in as (demo)</label>
        <div className="role-toggle">
          <button className={role === "client" ? "active" : ""} onClick={() => setRole("client")}>Client</button>
          <button className={role === "admin" ? "active" : ""} onClick={() => setRole("admin")}>For Granted admin</button>
        </div>
        <button className="btn" onClick={() => { if (signIn(email, role)) router.push("/library"); }}>Sign in</button>
        <div className="hint">Phase 1 scaffold — mock data, no real authentication yet.</div>
      </div>
    </div>
  );
}
