import { expect, test } from "bun:test";
import { parseBrowserUseCommand } from "./command";

test("empty and status are status", () => {
  expect(parseBrowserUseCommand("")).toEqual({ mode: "status" });
  expect(parseBrowserUseCommand(" status ")).toEqual({ mode: "status" });
});

test("on without flags does not auto-accept permissions", () => {
  expect(parseBrowserUseCommand("on")).toEqual({ mode: "on", acceptPermissions: false });
});

test("on with accept flags auto-accepts origin elicitations", () => {
  expect(parseBrowserUseCommand("on --accept-permissions")).toEqual({ mode: "on", acceptPermissions: true });
  expect(parseBrowserUseCommand("on --dangerously-accept-permissions")).toEqual({
    mode: "on",
    acceptPermissions: true,
  });
});

test("rejects unknown modes and mixed flags", () => {
  expect(parseBrowserUseCommand("always")).toEqual({ mode: "invalid" });
  expect(parseBrowserUseCommand("off extra")).toEqual({ mode: "invalid" });
  expect(parseBrowserUseCommand("on --persist")).toEqual({ mode: "invalid" });
});
