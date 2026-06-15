import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

export type CookieMap = Record<string, string>;
export type SupportedBrowser = "Brave" | "Chromium" | "Chrome";

export interface ChatGptCookieOptions {
  browser: SupportedBrowser;
  profile: string;
}

interface SqliteDatabase {
  prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>> };
  close(): void;
}

interface BrowserConfig {
  name: SupportedBrowser;
  baseDir: string;
  keychainService?: string;
  keychainAccount?: string;
  secretToolApp?: string;
}

const CHATGPT_COOKIE_HOSTS = ["chatgpt.com"];
const CHATGPT_SESSION_COOKIE_PREFIX = "__Secure-next-auth.session-token";
const BROWSER_IDS: Record<string, SupportedBrowser> = {
  brave: "Brave",
  chromium: "Chromium",
  chrome: "Chrome",
};
const MACOS_BROWSERS: BrowserConfig[] = [
  {
    name: "Brave",
    baseDir: "Library/Application Support/BraveSoftware/Brave-Browser",
    keychainService: "Brave Safe Storage",
    keychainAccount: "Brave",
  },
  {
    name: "Chromium",
    baseDir: "Library/Application Support/Chromium",
    keychainService: "Chromium Safe Storage",
    keychainAccount: "Chromium",
  },
  {
    name: "Chrome",
    baseDir: "Library/Application Support/Google/Chrome",
    keychainService: "Chrome Safe Storage",
    keychainAccount: "Chrome",
  },
];
const LINUX_BROWSERS: BrowserConfig[] = [
  { name: "Brave", baseDir: ".config/BraveSoftware/Brave-Browser", secretToolApp: "brave" },
  { name: "Chromium", baseDir: ".config/chromium", secretToolApp: "chromium" },
  { name: "Chrome", baseDir: ".config/google-chrome", secretToolApp: "chrome" },
];
const DEFAULT_LINUX_COOKIE_PASSWORD = "peanuts";

export function normalizeBrowserName(value: string): SupportedBrowser | null {
  const normalized = value.trim().toLowerCase();
  return BROWSER_IDS[normalized] ?? supportedBrowserNames().find((name) => name.toLowerCase() === normalized) ?? null;
}

export function supportedBrowserNames(): SupportedBrowser[] {
  return supportedBrowsers().map((browser) => browser.name);
}

export function isChatGptSessionCookieName(name: string): boolean {
  return name === CHATGPT_SESSION_COOKIE_PREFIX || name.startsWith(`${CHATGPT_SESSION_COOKIE_PREFIX}.`);
}

export function hasChatGptSessionCookie(cookies: CookieMap): boolean {
  return Object.keys(cookies).some(isChatGptSessionCookieName);
}

export async function getChatGptCookies(
  options: ChatGptCookieOptions,
): Promise<{ cookies: CookieMap; browser: SupportedBrowser } | null> {
  const currentPlatform = platform();
  const browsers = supportedBrowsers().filter((browser) => browser.name === options.browser);
  const hosts = normalizeCookieHosts(CHATGPT_COOKIE_HOSTS);
  if (hosts.length === 0) return null;

  for (const browser of browsers) {
    const cookiesPath = join(homedir(), browser.baseDir, options.profile, "Cookies");
    if (!existsSync(cookiesPath)) continue;

    const password = await readBrowserPassword(browser, currentPlatform);
    if (!password) continue;
    const key = pbkdf2Sync(password, "saltysalt", currentPlatform === "darwin" ? 1003 : 1, 16, "sha1");
    const tempDir = mkdtempSync(join(tmpdir(), "pi-oracle-cookies-"));

    try {
      const tempDb = join(tempDir, "Cookies");
      copyFileSync(cookiesPath, tempDb);
      copySidecar(cookiesPath, tempDb, "-wal");
      copySidecar(cookiesPath, tempDb, "-shm");

      const metaVersion = await readMetaVersion(tempDb);
      const rows = await queryCookieRows(tempDb, hosts);
      if (!rows) continue;
      const cookies: CookieMap = {};
      for (const row of rows) {
        const name = row.name;
        if (typeof name !== "string" || cookies[name]) continue;
        let value = typeof row.value === "string" && row.value.length > 0 ? row.value : null;
        if (!value && row.encrypted_value instanceof Uint8Array) {
          value = decryptCookieValue(row.encrypted_value, key, metaVersion >= 24);
        }
        if (value) cookies[name] = value;
      }
      if (!hasChatGptSessionCookie(cookies)) continue;
      return { cookies, browser: browser.name };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return null;
}

async function openReadonlyDatabase(dbPath: string): Promise<SqliteDatabase | null> {
  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning.message;
    if (message.includes("SQLite is an experimental feature")) return;
    return (originalEmitWarning as (...params: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;
  try {
    try {
      const sqlite = await import("node:sqlite");
      const options: Record<string, unknown> = { readOnly: true };
      if (supportsReadBigInts()) options.readBigInts = true;
      return new sqlite.DatabaseSync(dbPath, options) as SqliteDatabase;
    } catch {
      const sqlite = await import("bun:sqlite");
      return new sqlite.Database(dbPath, { readonly: true }) as SqliteDatabase;
    }
  } catch {
    return null;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function supportsReadBigInts(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 24 || (major === 24 && minor >= 4);
}

async function readMetaVersion(dbPath: string): Promise<number> {
  const db = await openReadonlyDatabase(dbPath);
  if (!db) return 0;
  try {
    const rows = db.prepare("SELECT value FROM meta WHERE key = 'version'").all();
    const value = rows[0]?.value;
    if (typeof value === "number") return Math.floor(value);
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "string") return Number.parseInt(value, 10) || 0;
    return 0;
  } finally {
    db.close();
  }
}

export function normalizeCookieHosts(hosts: string[]): string[] {
  const normalized = new Set<string>();
  for (const host of hosts) {
    const trimmed = host.trim().toLowerCase().replace(/^\.+/, "");
    if (trimmed) normalized.add(trimmed);
  }
  return [...normalized];
}

function cookieHostVariants(hosts: string[]): string[] {
  const normalized = normalizeCookieHosts(hosts);
  return [...normalized, ...normalized.map((host) => `.${host}`)];
}

async function queryCookieRows(dbPath: string, hosts: string[]): Promise<Array<Record<string, unknown>> | null> {
  const hostVariants = cookieHostVariants(hosts);
  if (hostVariants.length === 0) return [];

  const db = await openReadonlyDatabase(dbPath);
  if (!db) return null;
  try {
    const placeholders = hostVariants.map(() => "?").join(",");
    return db
      .prepare(`SELECT host_key, name, value, encrypted_value FROM cookies WHERE host_key IN (${placeholders})`)
      .all(...hostVariants) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function copySidecar(source: string, target: string, suffix: string): void {
  if (existsSync(source + suffix)) copyFileSync(source + suffix, target + suffix);
}

function decryptCookieValue(encrypted: Uint8Array, key: Buffer, stripHash: boolean): string | null {
  const buffer = Buffer.from(encrypted);
  if (buffer.length < 3 || !/^v\d\d$/.test(buffer.subarray(0, 3).toString("utf8"))) return null;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    decipher.setAutoPadding(false);
    const plaintext = Buffer.concat([decipher.update(buffer.subarray(3)), decipher.final()]);
    const unpadded = removePkcs7Padding(plaintext);
    const bytes = stripHash && unpadded.length >= 32 ? unpadded.subarray(32) : unpadded;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let firstPrintable = 0;
    while (firstPrintable < decoded.length && decoded.charCodeAt(firstPrintable) < 32) firstPrintable++;
    return decoded.slice(firstPrintable);
  } catch {
    return null;
  }
}

function removePkcs7Padding(buffer: Buffer): Buffer {
  if (buffer.length === 0) return buffer;
  const padding = buffer[buffer.length - 1];
  if (!padding || padding > 16) return buffer;
  return buffer.subarray(0, buffer.length - padding);
}

function readBrowserPassword(
  browser: BrowserConfig,
  currentPlatform: ReturnType<typeof platform>,
): Promise<string | null> {
  if (currentPlatform === "darwin") {
    const { keychainAccount, keychainService } = browser;
    if (!keychainAccount || !keychainService) return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile(
        "security",
        ["find-generic-password", "-w", "-a", keychainAccount, "-s", keychainService],
        { timeout: 5000 },
        (err, stdout) => {
          resolve(err ? null : stdout.trim() || null);
        },
      );
    });
  }
  if (currentPlatform === "linux") {
    return new Promise((resolve) => {
      if (!browser.secretToolApp) {
        resolve(DEFAULT_LINUX_COOKIE_PASSWORD);
        return;
      }
      execFile("secret-tool", ["lookup", "application", browser.secretToolApp], { timeout: 5000 }, (err, stdout) => {
        const password = stdout.trim();
        resolve(err || !password ? DEFAULT_LINUX_COOKIE_PASSWORD : password);
      });
    });
  }
  return Promise.resolve(null);
}

function supportedBrowsers(): BrowserConfig[] {
  const currentPlatform = platform();
  if (currentPlatform === "darwin") return MACOS_BROWSERS;
  if (currentPlatform === "linux") return LINUX_BROWSERS;
  return [];
}
