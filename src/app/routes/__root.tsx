import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { AuthSync } from "@/features/auth";

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
      <div className="mx-auto flex h-full max-w-6xl flex-col">
        <AuthSync />
        <Outlet />
      </div>
      <Toaster position="top-center" richColors />
    </ThemeProvider>
  );
}
