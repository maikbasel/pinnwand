import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import { SidebarRail } from "./sidebar-rail";
import { TopAppBar } from "./top-app-bar";

/** Persistent authed shell: desktop sidebar rail on the left, mobile top app
 * bar above the page content. Mounted once in the `_authed` layout so it never
 * remounts across in-app navigation. Tailwind breakpoints, not JS, decide which
 * chrome is visible. */
export function NavigationShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <SidebarRail />
      <SidebarInset>
        <TopAppBar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
