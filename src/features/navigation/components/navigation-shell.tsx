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
      {/* Right column. The mobile top app bar is a real `banner` landmark ABOVE
          the page's <main>, never nested inside it — a <header> descended from
          <main> is not a banner per ARIA, which left the mobile shell with no
          banner at all. Desktop hides the bar (the rail carries navigation), so
          the banner collapses out of the a11y tree there. */}
      <div className="relative flex min-w-0 flex-1 flex-col bg-background">
        <TopAppBar />
        <SidebarInset className="min-h-0 bg-transparent">
          {/* min-h-0 lets a page opt into filling the viewport with internal
              scroll (the board). Page-scroll routes keep growing past it because
              their own root has an auto min-height. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
