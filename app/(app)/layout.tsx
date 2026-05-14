import { type ReactNode } from "react";
import { BottomNav } from "@/components/app/bottom-nav";
import { SideNav } from "@/components/app/side-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="s-shell">
      <SideNav />
      <div className="s-main s-root">
        {children}
        <BottomNav />
      </div>
    </div>
  );
}
