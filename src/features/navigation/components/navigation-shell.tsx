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
        {/* min-h-0 lets a page opt into filling the viewport with internal
            scroll (the board). Page-scroll routes keep growing past it because
            their own root has an auto min-height. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
