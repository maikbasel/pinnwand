import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth, SignOutButton } from "@/features/auth";

export const Route = createFileRoute("/_authed")({
  beforeLoad: requireAuth,
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold tracking-tight">Pinnwand</span>
        <SignOutButton />
      </header>
      <Outlet />
    </div>
  );
}
