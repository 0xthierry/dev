// External ai-memory service fixture; production extension and Pi remain real.
export function memoryResponse(body: { id?: unknown; method?: unknown }): Response {
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  const result =
    body.method === "tools/list"
      ? {
          tools: [
            {
              name: "memory_status",
              description: "Read project memory status",
              inputSchema: {
                type: "object",
                properties: { workspace: { type: "string" }, project: { type: "string" } },
                required: ["workspace", "project"],
                additionalProperties: false,
              },
            },
          ],
        }
      : body.method === "tools/call"
        ? { content: [{ type: "text", text: "Fixture memory status: ready" }] }
        : { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
  return Response.json({ jsonrpc: "2.0", id: body.id, result });
}
