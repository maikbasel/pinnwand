/// <reference types="vitest/config" />
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "src/app/routes",
      generatedRouteTree: "src/app/routeTree.gen.ts",
      autoCodeSplitting: true,
      routeFileIgnorePattern: "__tests__|\\.test\\.",
    }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Pinnwand",
        short_name: "Pinnwand",
        description: "Geteilte Aufgaben-Boards für dein Team.",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        lang: "de",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Integration tests live under src/**/*.integration.test.ts and need a
    // Postgres testcontainer; they have their own vitest.integration.config.ts.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.integration.test.ts",
    ],
  },
});
