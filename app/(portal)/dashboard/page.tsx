import { redirect } from "next/navigation";
// The Dashboard is folded into the Account page (a card to the right of the
// profile/security cards). This route now just redirects there.
export default function DashboardPage() {
  redirect("/account");
}
