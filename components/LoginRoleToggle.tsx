"use client";
import { useState } from "react";
export default function LoginRoleToggle() {
  const [role, setRole] = useState("client");
  return (
    <div>
      <label>Sign in as (demo)</label>
      <div className="role-toggle">
        <button type="button" className={role === "client" ? "active" : ""} onClick={() => setRole("client")}>Client</button>
        <button type="button" className={role === "admin" ? "active" : ""} onClick={() => setRole("admin")}>For Granted admin</button>
      </div>
      <input type="hidden" name="role" value={role} />
    </div>
  );
}
