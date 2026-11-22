import { afterEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFakePi } from "./_shared/testing/fake-pi";
import registerTheme, { omarchyPiTheme } from "./omarchy-system-theme";

const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const homes: string[] = [];
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "pi-omarchy-theme-"));
  homes.push(home);
  return home;
}
afterEach(() => {
  process.env.HOME = originalHome;
  process.env.PATH = originalPath;
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

test("session polling applies theme switches through Pi's UI", async () => {
  // Arrange
  process.env.HOME = fixture();
  const theme = join(process.env.HOME, ".local/state/omarchy/current/theme");
  mkdirSync(theme, { recursive: true });
  writeFileSync(join(theme, "colors.toml"), 'mode = "light"\n');
  process.env.PATH = `${process.env.OMARCHY_TEST_UPSTREAM_BIN ?? resolve(import.meta.dir, "../../../../../upstream/bin")}:${originalPath}`;
  const setTheme = mock((_theme: string) => ({ success: true }));
  const fake = createFakePi({ ctx: { hasUI: true, ui: { setTheme } } });
  registerTheme(fake.pi);
  // Act
  try {
    await fake.emit("session_start");
    writeFileSync(join(theme, "colors.toml"), 'mode = "dark"\n');
    await new Promise((resolve) => setTimeout(resolve, 2100));
    // Assert
    expect(setTheme.mock.calls).toEqual([["light"], ["dark"]]);
  } finally {
    await fake.emit("session_shutdown");
  }
});
