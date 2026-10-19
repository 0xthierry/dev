import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "gen_catalog.ts");

// One operation per case the catalog distinguishes: key + scopes + limits + in-game, a deprecated
// key operation, an untagged one on another host, a cookie-only one and one without auth.
const SPEC = {
  servers: [{ url: "https://apis.roblox.com" }],
  paths: {
    "/cloud/v2/universes/{universe_id}": {
      parameters: [{ name: "universe_id", in: "path" }],
      patch: { tags: ["Universes (beta)"], security: [{ "roblox-api-key": [] }], deprecated: true, operationId: "Cloud_UpdateUniverse" },
      get: {
        tags: ["Universes (beta)"],
        security: [{ "roblox-api-key": [] }, { "roblox-oauth2": [] }],
        "x-roblox-stability": "STABLE",
        "x-roblox-scopes": [{ name: "universe:read" }, { name: "universe:read" }, { name: "universe:write", firstPartyOAuthOnly: true }],
        "x-roblox-rate-limits": { perApiKeyOwner: { maxInPeriod: 120, period: "MINUTE" }, description: "and more" },
        "x-roblox-engine-usability": { apiKeyWithHttpService: true },
        summary: "Get  a\n universe | detail",
      },
    },
    "/v1/thumbs": {
      get: { security: [{ "roblox-api-key": [] }], servers: [{ url: "https://thumbnails.roblox.com" }], summary: "x".repeat(120) },
    },
    "/v1/legacy": { post: { tags: ["Legacy"], security: [{ "roblox-legacy-cookie": [] }] } },
    "/v1/public": { get: { tags: ["Legacy"] } },
  },
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gen-catalog-test-"));
  writeFileSync(join(dir, "openapi.json"), JSON.stringify(SPEC));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function generate(): { code: number; stdout: string; catalog: string } {
  const proc = Bun.spawnSync([process.execPath, SCRIPT, "--spec", join(dir, "openapi.json"), "--source", "fixture@1", "--out", join(dir, "catalog.md")]);
  return { code: proc.exitCode, stdout: proc.stdout.toString(), catalog: readFileSync(join(dir, "catalog.md"), "utf8") };
}

test("counts every documented operation by how it authenticates", () => {
  const { code, stdout, catalog } = generate();

  expect(code).toBe(0);
  expect(stdout).toContain("3 operations in 2 groups (fixture@1)");
  expect(catalog).toContain("from Roblox's official OpenAPI document (fixture@1).");
  expect(catalog).toContain(
    "3 of 5 documented operations accept the `x-api-key` header. Of the rest, 1 accept only the browser session cookie " +
      "(legacy endpoints: never call them from automation) and 1 declare no auth scheme.",
  );
});

test("lists key operations by tag with scopes, limits and a cleaned summary", () => {
  const lines = generate().catalog.split("\n");

  expect(lines).toContain("| [Universes (beta)](#universes-beta) | 2 |");
  expect(lines).toContain("| [Untagged](#untagged) | 1 |");
  const get =
    "| GET | `apis.roblox.com/cloud/v2/universes/{universe_id}` | stable | `universe:read`, `universe:write (1P OAuth)` | 120/minute +more | yes | Get a universe / detail |";
  const patch = "| PATCH | `apis.roblox.com/cloud/v2/universes/{universe_id}` | deprecated |  |  |  | Cloud_UpdateUniverse |";
  expect(lines.indexOf(get)).toBeGreaterThan(-1);
  expect(lines.indexOf(patch)).toBe(lines.indexOf(get) + 1); // sorted by endpoint, then method
  expect(lines).toContain(`| GET | \`thumbnails.roblox.com/v1/thumbs\` |  |  |  |  | ${"x".repeat(90)} |`);
  expect(lines.join("\n")).not.toContain("/v1/legacy");
});
