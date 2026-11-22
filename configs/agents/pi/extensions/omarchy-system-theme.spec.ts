import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { omarchyPiTheme } from "./omarchy-system-theme";

// Adapter integration, not a live Pi TUI check. The pristine 4.5.0 resolver is
// the real subprocess; HOME and palette files are isolated per test.
const oldPath = process.env.PATH;
const homes: string[] = [];
afterEach(() => {
  process.env.PATH = oldPath;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function fixture(palette: string) {
  const home = mkdtempSync(join(tmpdir(), "pi-quattro-theme-"));
  homes.push(home);
  const theme = join(home, ".local/state/omarchy/current/theme");
  mkdirSync(theme, { recursive: true });
  writeFileSync(join(theme, "colors.toml"), palette);
  process.env.PATH = `${process.env.OMARCHY_TEST_UPSTREAM_BIN ?? resolve(import.meta.dir, "../../../../../upstream/bin")}:${oldPath}`;
  return { home, theme };
}

test("Quattro explicit dark wins over a stale legacy light marker", () => {
  // Arrange
  const { home } = fixture('mode = "dark"\nbackground = "#ffffff"\n');
  const legacy = join(home, ".config/omarchy/current/theme");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "light.mode"), "");
  // Act
  const mode = omarchyPiTheme(home);
  // Assert
  expect(mode).toBe("dark");
});

test("Quattro switches from explicit light to background-derived dark", () => {
  // Arrange
  const { home, theme } = fixture('mode = "light"\n');
  // Act
  const light = omarchyPiTheme(home);
  writeFileSync(join(theme, "colors.toml"), 'background = "#111111"\n');
  const dark = omarchyPiTheme(home);
  // Assert
  expect([light, dark]).toEqual(["light", "dark"]);
});

test("Quattro understands legacy theme_type palettes without a marker", () => {
  // Arrange
  const { home } = fixture('theme_type = "light"\n');
  // Act
  const mode = omarchyPiTheme(home);
  // Assert
  expect(mode).toBe("light");
});

test("unavailable Quattro resolver retains the current Pi theme", () => {
  // Arrange
  const { home } = fixture('mode = "light"\n');
  process.env.PATH = home;
  // Act
  const mode = omarchyPiTheme(home);
  // Assert
  expect(mode).toBeNull();
});
