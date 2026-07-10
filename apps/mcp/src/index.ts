import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { resourceMetadata } from "./auth/resource-metadata";
import { supabaseForUser } from "./auth/supabase-for-user";
import { AuthError, verifyToken } from "./auth/verify-token";
import { env } from "./env";
import { logger } from "./logger";
import { createMcpServer } from "./mcp/server";

export const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/.well-known/oauth-protected-resource", (_req, res) =>
  res.json(resourceMetadata())
);

app.post("/mcp", express.json(), async (req, res) => {
  let auth: Awaited<ReturnType<typeof verifyToken>>;
  try {
    auth = await verifyToken(req.headers.authorization);
  } catch (err) {
    if (!(err instanceof AuthError)) {
      throw err;
    }
    const metadataUrl = `${env.MCP_PUBLIC_URL}/.well-known/oauth-protected-resource`;
    res
      .status(401)
      .set("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`)
      .json({ error: "unauthorized", message: err.message });
    return;
  }

  const supabase = supabaseForUser(auth.token);
  const server = createMcpServer({ supabase, userId: auth.userId });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

if (process.env.NODE_ENV !== "test") {
  app.listen(env.PORT, () => logger.info({ port: env.PORT }, "mcp listening"));
}
