import { createProvider } from "../dist/providers/index.js";

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
  console.log("--- Running test-providers.js ---");
  try {
    // 1. createProvider("groq") instantiates without error
    try {
      const provider = await createProvider("groq");
      check('createProvider("groq") instantiates without error', !!provider);
    } catch (e) {
      check('createProvider("groq") instantiates without error', false, e?.message ?? String(e));
    }

    // 2. createProvider("ollama") instantiates without error
    try {
      const provider = await createProvider("ollama");
      check('createProvider("ollama") instantiates without error', !!provider);
    } catch (e) {
      check('createProvider("ollama") instantiates without error', false, e?.message ?? String(e));
    }

    // 3. createProvider("google") instantiates without error
    try {
      const provider = await createProvider("google");
      check('createProvider("google") instantiates without error', !!provider);
    } catch (e) {
      check('createProvider("google") instantiates without error', false, e?.message ?? String(e));
    }

    // 4. supportsTools flags correct per provider
    try {
      const groq = await createProvider("groq");
      const ollama = await createProvider("ollama");
      const openai = await createProvider("openai");

      check(
        "Provider supportsTools flag correct per provider (ollama: false, groq: false, others: true)",
        ollama.supportsTools === false &&
          groq.supportsTools === false &&
          openai.supportsTools === true,
      );
    } catch (e) {
      check(
        "Provider supportsTools flag correct per provider (ollama: false, groq: false, others: true)",
        false,
        e?.message ?? String(e),
      );
    }

    // 5. Resilience helpers behave as expected (no real API calls).
    try {
      const { isTransientError, withFirstTokenTimeout } =
        await import("../dist/providers/resilience.js");

      check(
        "Retry predicate treats 429 as transient",
        isTransientError(new Error("Rate limit 429")) === true,
      );

      let timeoutThrew = false;
      async function* mockedSlowStream() {
        await new Promise((r) => setTimeout(r, 100));
        yield "token";
      }
      try {
        const slow = withFirstTokenTimeout(mockedSlowStream(), 10);
        for await (const _chunk of slow) {
          // no-op
        }
      } catch (e) {
        if (
          String(e?.message ?? e)
            .toLowerCase()
            .includes("timeout")
        ) {
          timeoutThrew = true;
        }
      }

      check("First token timeout triggers", timeoutThrew, "Expected timeout");
    } catch (e) {
      check("Resilience helpers behave as expected", false, e?.message ?? String(e));
    }
  } catch (err) {
    check("script crashed", false, err?.message ?? String(err));
  }

  console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
