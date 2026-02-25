import { closeBrowser, openPage, search } from "../dist/browser/browser.js";

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
  console.log("--- Running test-browser.js ---");

  let content = "";
  try {
    // 1. Playwright imports without error (lazy)
    try {
      const pw = await import("playwright");
      check("Playwright imports without error", !!pw.chromium);
    } catch (e) {
      check("Playwright imports without error", false, e?.message ?? String(e));
    }

    // 2. openPage returns non-empty string content (or throws cleanly if network is unavailable)
    try {
      content = await openPage("https://example.com");
      check('openPage("https://example.com") returns non-empty content', content.length > 0);
    } catch (e) {
      const message = e?.message ?? String(e);
      if (message.includes("ENOTFOUND") || message.includes("EAI_AGAIN")) {
        check('openPage("https://example.com") fails cleanly when offline', true);
      } else {
        check('openPage("https://example.com") returns non-empty content', false, message);
      }
    }

    // 3. Content capped at 8000 characters
    check("Content capped at 8000 characters", content.length <= 8000, `Length: ${content.length}`);

    // 4. search returns results with title/url/snippet (or throws cleanly if offline)
    try {
      const results = await search("Lucknow restaurants");
      const valid =
        Array.isArray(results) &&
        results.length > 0 &&
        results.every((r) => r.title && r.url && typeof r.snippet === "string");
      check(
        'search("Lucknow restaurants") returns results',
        valid,
        `Found ${results.length} results`,
      );
    } catch (e) {
      const message = e?.message ?? String(e);
      if (message.includes("ENOTFOUND") || message.includes("EAI_AGAIN")) {
        check('search("Lucknow restaurants") fails cleanly when offline', true);
      } else {
        check('search("Lucknow restaurants") returns results', false, message);
      }
    }
  } catch (err) {
    check("script crashed", false, err?.message ?? String(err));
  } finally {
    await closeBrowser().catch(() => {});
  }

  console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
