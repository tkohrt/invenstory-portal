"use client";
// The "?" help menu in the top bar (patch 15, onboarding build, 3 Nov 2026).
import { usePathname, useRouter } from "next/navigation";
import MenuButton, { MenuItem } from "./MenuButton";
import { TOUR_EVENT, tourForPath } from "@/lib/tours";
import { SUPPORT_EMAIL } from "@/lib/uploads";

export default function HelpMenu({ guide }: { guide: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const tour = tourForPath(path);
  return (
    <MenuButton label="Help" icon={<span aria-hidden className="help-q">?</span>} floating className="help-menu">
      {tour && <MenuItem title="Show me around this page" hint={`A short tour of ${tour.name}.`}
        onClick={() => window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { key: tour.key } }))} />}
      {guide && <MenuItem title="Ask the Portal Guide" hint="How the portal works. Never counts against your AI allowance."
        onClick={() => router.push("/chat?tab=guide")} />}
      <MenuItem title="Email For Granted" hint={SUPPORT_EMAIL} onClick={() => { window.location.href = `mailto:${SUPPORT_EMAIL}`; }} />
    </MenuButton>
  );
}
