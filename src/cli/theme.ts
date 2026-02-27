import chalk, { type ChalkInstance } from "chalk";

import { closeHiveDatabase, getMetaValue, openHiveDatabase } from "../storage/db.js";

export const DEFAULT_THEME_NAME = "amber";
export const DEFAULT_THEME_HEX = "#FFA500";

export const BUILT_IN_THEMES = {
  amber: "#FFA500",
  cyan: "#00BCD4",
  rose: "#FF4081",
  slate: "#90A4AE",
  green: "#00E676",
  blue: "#00E676",
} as const;

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export type BuiltInThemeName = keyof typeof BUILT_IN_THEMES;
export type ThemeName = BuiltInThemeName | "custom";

export interface HiveTheme {
  name: ThemeName;
  hex: string;
  accent: ChalkInstance;
}

let cachedTheme: HiveTheme | null = null;

export function applyTheme(hex: string): ChalkInstance {
  const normalizedHex = normalizeHex(hex);
  return chalk.hex(normalizedHex);
}

export function getTheme(): HiveTheme {
  if (cachedTheme) {
    return cachedTheme;
  }

  let db: ReturnType<typeof openHiveDatabase> | null = null;

  try {
    db = openHiveDatabase();
    const storedName = getMetaValue(db, "theme");
    const storedHex = getMetaValue(db, "theme_hex");
    cachedTheme = resolveTheme(storedName, storedHex);
    return cachedTheme;
  } catch {
    cachedTheme = makeTheme(DEFAULT_THEME_NAME, DEFAULT_THEME_HEX);
    return cachedTheme;
  } finally {
    if (db) {
      closeHiveDatabase(db);
    }
  }
}

export function invalidateThemeCache(): void {
  cachedTheme = null;
}

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

function resolveTheme(storedName: string | null, storedHex: string | null): HiveTheme {
  if (isBuiltInTheme(storedName)) {
    return makeTheme(storedName, BUILT_IN_THEMES[storedName]);
  }

  if (storedName === "custom" && storedHex && isValidHexColor(storedHex)) {
    return makeTheme("custom", storedHex);
  }

  return makeTheme(DEFAULT_THEME_NAME, DEFAULT_THEME_HEX);
}

function makeTheme(name: ThemeName, hex: string): HiveTheme {
  const normalizedHex = normalizeHex(hex);
  return {
    name,
    hex: normalizedHex,
    accent: applyTheme(normalizedHex),
  };
}

function normalizeHex(value: string): string {
  if (!isValidHexColor(value)) {
    return DEFAULT_THEME_HEX;
  }

  return value.toUpperCase();
}

function isBuiltInTheme(value: string | null): value is BuiltInThemeName {
  return value !== null && value in BUILT_IN_THEMES;
}
