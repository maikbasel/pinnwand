import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth";
import { NavigationShell } from "@/features/navigation";

export const Route = createFileRoute("/_authed")({
  beforeLoad: requireAuth,
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <NavigationShell>
      <Outlet />
    </NavigationShell>
  );
}
