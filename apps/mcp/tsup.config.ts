import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // @pinnwand/contracts ships only .ts (no build step); tsup externalizes
  // workspace deps by default, which leaves a bare `import "@pinnwand/contracts"`
  // node can't resolve at runtime. Force-bundle it inline; every other dep
  // (express, @supabase/supabase-js, etc.) stays external and comes from
  // node_modules in the runtime image.
  noExternal: [/@pinnwand\/contracts/],
});
