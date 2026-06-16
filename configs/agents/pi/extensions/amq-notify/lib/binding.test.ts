import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BINDING_ENTRY, resolveBinding } from "./binding";

type Entry = { type: string; customType?: string; data?: unknown };

function createRuntime(entries: Entry[] = []) {
  const appended: Array<{ customType: string; data?: unknown }> = [];
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      appended.push({ customType, data });
    },
  } as ExtensionAPI;
  const ctx = {
    cwd: "/repo",
    sessionManager: { getEntries: () => entries },
  } as ExtensionContext;

  return { pi, ctx, appended };
}

describe("resolveBinding", () => {
  test("restores the latest persisted binding outside forks", () => {
    // Arrange
    const entries = [
      { type: "custom", customType: BINDING_ENTRY, data: { root: "/old", me: "pi" } },
      { type: "custom", customType: BINDING_ENTRY, data: { root: "/new", me: "main" } },
    ];
    const runtime = createRuntime(entries);

    // Act
    const binding = resolveBinding(runtime.pi, runtime.ctx, "reload");

    // Assert
    expect(binding).toEqual({ root: "/new", me: "main" });
    expect(runtime.appended).toEqual([]);
  });

  test("mints and persists a fresh binding when no binding exists", () => {
    // Arrange
    const runtime = createRuntime();

    // Act
    const binding = resolveBinding(runtime.pi, runtime.ctx, "startup");

    // Assert
    expect(binding.root).toMatch(/^\/repo\/\.agent-mail\/pi-[a-f0-9]{8}$/);
    expect(binding.me).toBe("pi");
    expect(runtime.appended).toEqual([{ customType: BINDING_ENTRY, data: binding }]);
  });

  test("mints a fresh binding for forks instead of reusing the parent queue", () => {
    // Arrange
    const runtime = createRuntime([{ type: "custom", customType: BINDING_ENTRY, data: { root: "/parent", me: "pi" } }]);

    // Act
    const binding = resolveBinding(runtime.pi, runtime.ctx, "fork");

    // Assert
    expect(binding.root).not.toBe("/parent");
    expect(runtime.appended).toEqual([{ customType: BINDING_ENTRY, data: binding }]);
  });
});
