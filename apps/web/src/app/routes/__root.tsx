import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { AuthSync } from "@/features/auth";
import { Toaster } from "@/shared/components/ui/sonner";

type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="theme"
    >
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <AuthSync />
        <Outlet />
      </div>
      <Toaster position="top-center" richColors />
    </ThemeProvider>
  );
}
