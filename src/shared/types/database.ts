// PLACEHOLDER — regenerate with `pnpm db:types` once the local Supabase stack is
// running (supabase gen types typescript --local). Never edit by hand.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Minimal shape so `createClient<Database>` compiles before the first
// `pnpm db:types` run. Replaced wholesale by the generated types.
export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      task_column: "offen" | "zu_erledigen" | "in_bearbeitung" | "erledigt";
      task_priority: "niedrig" | "mittel" | "hoch";
      board_role: "owner" | "member";
    };
    CompositeTypes: Record<string, never>;
  };
};
