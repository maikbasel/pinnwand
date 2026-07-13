import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@pinnwand/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerBoardTools } from "./tools/boards";
import { registerMemberTools } from "./tools/members";
import { registerTaskTools } from "./tools/tasks";

export type ToolContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "pinnwand", version: "1.0.0" });

  server.registerTool(
    "whoami",
    { description: "Return the authenticated user's id." },
    () => ({ content: [{ type: "text", text: ctx.userId }] })
  );

  registerBoardTools(server, ctx);
  registerTaskTools(server, ctx);
  registerMemberTools(server, ctx);

  return server;
}
