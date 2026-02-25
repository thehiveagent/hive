import {
  openHiveDatabase,
  closeHiveDatabase,
  getMetaValue,
  setMetaValue,
} from "../dist/storage/db.js";

let passed = 0;
let failed = 0;

function check(label, ok, err) {
  if (ok) {
    console.log(`✓ ${label}`);
    passed += 1;
    return;
  }

  console.log(`✗ ${label} — ${err || "Assertion failed"}`);
  failed += 1;
}

async function main() {
  console.log("--- Running test-theme.js ---");
  let db = null;
  let originalTheme = null;
  let originalHex = null;

  try {
    db = openHiveDatabase();
    originalTheme = getMetaValue(db, "theme");
    originalHex = getMetaValue(db, "theme_hex");

    setMetaValue(db, "theme", "amber");
    check('getMetaValue(db, "theme") returns amber', getMetaValue(db, "theme") === "amber");

    setMetaValue(db, "theme_hex", "#FFA500");
    check(
      'getMetaValue(db, "theme_hex") returns #FFA500',
      getMetaValue(db, "theme_hex") === "#FFA500",
    );

    setMetaValue(db, "theme", "custom");
    setMetaValue(db, "theme_hex", "#FF6B6B");
    check("Custom hex stored correctly", getMetaValue(db, "theme_hex") === "#FF6B6B");

    try {
      const { isValidHexColor } = await import("../dist/cli/theme.js");
      check("Invalid hex rejected by validator", isValidHexColor("#ZZZZZZ") === false);
    } catch (e) {
      check("Invalid hex rejected by validator", false, e?.message ?? String(e));
    }
  } catch (err) {
    check("script crashed", false, err?.message ?? String(err));
  } finally {
    if (db) {
      if (originalTheme) setMetaValue(db, "theme", originalTheme);
      if (originalHex) setMetaValue(db, "theme_hex", originalHex);
      closeHiveDatabase(db);
    }
  }

  console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
