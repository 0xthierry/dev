import { describe, expect, test } from "bun:test";
import { resolveBinding, sanitizeTag } from "./session";

describe("sanitizeTag", () => {
  test("lowercases and replaces invalid characters", () => {
    expect(sanitizeTag("Pi-AbC_12")).toBe("pi-abc_12");
  });

  test("strips leading and trailing separators", () => {
    expect(sanitizeTag("--Foo!!")).toBe("foo");
  });

  test("falls back to 'pi' when nothing valid remains", () => {
    expect(sanitizeTag("!!!")).toBe("pi");
  });
});

describe("resolveBinding", () => {
  test("derives a unique session under cwd/.agent-mail when AM_ROOT is unset", () => {
    const binding = resolveBinding({}, "/repo", () => "abc12345");

    expect(binding).toEqual({
      root: "/repo/.agent-mail/pi-abc12345",
      me: "pi",
      derived: true,
    });
  });

  test("respects an inherited AM_ROOT/AM_ME (coop-exec worker)", () => {
    const binding = resolveBinding({ AM_ROOT: "/repo/.agent-mail/feature-x", AM_ME: "pi" }, "/repo", () => "unused");

    expect(binding).toEqual({
      root: "/repo/.agent-mail/feature-x",
      me: "pi",
      derived: false,
    });
  });

  test("two pis in the same repo derive different roots", () => {
    let n = 0;
    const a = resolveBinding({}, "/repo", () => `id${n++}`);
    const b = resolveBinding({}, "/repo", () => `id${n++}`);

    expect(a.root).not.toBe(b.root);
  });
});
