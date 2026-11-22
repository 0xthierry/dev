import { afterEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePi } from "./_shared/testing/fake-pi";
import registerTheme, { omarchyPiTheme } from "./omarchy-system-theme";

const originalHome = process.env.HOME;
const homes: string[] = [];
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "pi-omarchy-theme-"));
  homes.push(home);
  return home;
}
afterEach(() => {
  process.env.HOME = originalHome;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("non-Omarchy homes retain their selected theme", () => {
  // Arrange
  const home = fixture();
  // Act
  const theme = omarchyPiTheme(home);
  // Assert
  expect(theme).toBeNull();
});

test("legacy marker switches light to dark when removed", () => {
  // Arrange
  const home = fixture();
  const theme = join(home, ".config/omarchy/current/theme");
  mkdirSync(theme, { recursive: true });
  writeFileSync(join(theme, "light.mode"), "");
  // Act
  const light = omarchyPiTheme(home);
  rmSync(join(theme, "light.mode"));
  const dark = omarchyPiTheme(home);
  // Assert
  expect([light, dark]).toEqual(["light", "dark"]);
});

test("session polling applies theme switches through Pi's UI", async () => {
  // Arrange
  process.env.HOME = fixture();
  const theme = join(process.env.HOME, ".config/omarchy/current/theme");
  mkdirSync(theme, { recursive: true });
  writeFileSync(join(theme, "light.mode"), "");
  const setTheme = mock((_theme: string) => ({ success: true }));
  const fake = createFakePi({ ctx: { hasUI: true, ui: { setTheme } } });
  registerTheme(fake.pi);
  // Act
  try {
    await fake.emit("session_start");
    rmSync(join(theme, "light.mode"));
    await new Promise((resolve) => setTimeout(resolve, 2100));
    // Assert
    expect(setTheme.mock.calls).toEqual([["light"], ["dark"]]);
  } finally {
    await fake.emit("session_shutdown");
  }
});
