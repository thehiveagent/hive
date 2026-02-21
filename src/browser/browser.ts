import { chromium } from "playwright";
import fetch from "node-fetch";

const MAX_CONTENT_CHARS = 8000;
const SEARCH_RESULT_LIMIT = 5;
const SEARCH_SNIPPET_CHARS = 280;
const SEARCH_WINDOW_CHARS = 2600;
const BROWSER_TIMEOUT_MS = 30000;
const DEFAULT_REQUEST_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function openPage(url: string): Promise<string> {
  try {
    return await openPageWithBrowser(url);
  } catch {
    return openPageWithHttp(url);
  }
}

export async function extractContent(url: string): Promise<string> {
  return openPage(url);
}

export async function search(query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return [];
  }

  let browserResults: SearchResult[] = [];
  try {
    const browser = await launchBrowser();

    try {
      const page = await browser.newPage();
      const searchUrls = [
        `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmedQuery)}`,
        `https://www.google.com/search?q=${encodeURIComponent(trimmedQuery)}&hl=en&num=10&pws=0`,
      ];

      for (const searchUrl of searchUrls) {
        try {
          await page.goto(searchUrl, {
            waitUntil: "domcontentloaded",
            timeout: BROWSER_TIMEOUT_MS,
          });
        } catch {
          continue;
        }

        const html = await page.content();
        const results =
          searchUrl.includes("duckduckgo.com")
            ? parseDuckDuckGoResults(html)
            : parseGoogleResults(html);

        if (results.length > 0) {
          browserResults = results;
          break;
        }
      }
    } finally {
      await browser.close();
    }
  } catch {
    // Continue to HTTP fallback below.
  }

  if (browserResults.length > 0) {
    return browserResults.slice(0, SEARCH_RESULT_LIMIT);
  }

  const fallbackResults = await searchWithHttp(trimmedQuery);
  return fallbackResults.slice(0, SEARCH_RESULT_LIMIT);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ headless: true, channel: "chrome" });
  }
}

async function openPageWithBrowser(url: string): Promise<string> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS });
    const html = await page.content();
    return extractReadableText(html);
  } finally {
    await browser.close();
  }
}

async function openPageWithHttp(url: string): Promise<string> {
  const html = await fetchHtml(url);
  return extractReadableText(html);
}

async function searchWithHttp(query: string): Promise<SearchResult[]> {
  const searchUrls = [
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=10&pws=0`,
  ];
  let lastError: unknown = null;
  let hadSuccessfulRequest = false;

  for (const searchUrl of searchUrls) {
    let html: string;
    try {
      html = await fetchHtml(searchUrl);
    } catch (error) {
      lastError = error;
      continue;
    }
    hadSuccessfulRequest = true;

    const results =
      searchUrl.includes("duckduckgo.com")
        ? parseDuckDuckGoResults(html)
        : parseGoogleResults(html);
    if (results.length > 0) {
      return results;
    }
  }

  if (!hadSuccessfulRequest && lastError) {
    throw lastError;
  }

  return [];
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: DEFAULT_REQUEST_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Request failed: HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseGoogleResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null = anchorPattern.exec(html);
  while (match && results.length < SEARCH_RESULT_LIMIT) {
    const rawHref = decodeHtmlEntities(match[1]);
    const titleMatch = match[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);

    if (titleMatch) {
      const parsedUrl = normalizeGoogleResultUrl(rawHref);
      if (parsedUrl && !seenUrls.has(parsedUrl)) {
        const title = cleanupText(titleMatch[1]);
        if (title.length > 0) {
          const snippet = extractSnippetForMatch(html, match.index, [
            /<(?:div|span)\b[^>]*class="[^"]*(?:VwiC3b|aCOpRe|s3v9rd)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i,
            /<div\b[^>]*>([\s\S]{40,900}?)<\/div>/i,
          ]);
          results.push({
            title,
            url: parsedUrl,
            snippet,
          });
          seenUrls.add(parsedUrl);
        }
      }
    }

    match = anchorPattern.exec(html);
  }

  return results;
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  const anchorPattern =
    /<a\b[^>]*class="[^"]*(?:result__a|result-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null = anchorPattern.exec(html);
  while (match && results.length < SEARCH_RESULT_LIMIT) {
    const rawHref = decodeHtmlEntities(match[1]);
    const parsedUrl = normalizeDuckDuckGoResultUrl(rawHref);

    if (parsedUrl && !seenUrls.has(parsedUrl)) {
      const title = cleanupText(match[2]);
      if (title.length > 0) {
        const snippet = extractSnippetForMatch(html, match.index, [
          /<(?:a|div|span)\b[^>]*class="[^"]*(?:result__snippet|result-snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i,
          /<div\b[^>]*>([\s\S]{40,900}?)<\/div>/i,
        ]);
        results.push({
          title,
          url: parsedUrl,
          snippet,
        });
        seenUrls.add(parsedUrl);
      }
    }

    match = anchorPattern.exec(html);
  }

  return results;
}

function normalizeGoogleResultUrl(rawHref: string): string | null {
  if (!rawHref) {
    return null;
  }

  if (rawHref.startsWith("/url?")) {
    const queryString = rawHref.split("?")[1] ?? "";
    const params = new URLSearchParams(queryString);
    const q = params.get("q") ?? params.get("url");
    if (!q) {
      return null;
    }
    return normalizeExternalUrl(q);
  }

  if (!/^https?:\/\//i.test(rawHref)) {
    return null;
  }

  return normalizeExternalUrl(rawHref);
}

function normalizeDuckDuckGoResultUrl(rawHref: string): string | null {
  if (!rawHref) {
    return null;
  }

  if (rawHref.startsWith("//duckduckgo.com/l/?")) {
    return extractDuckDuckGoRedirectTarget(`https:${rawHref}`);
  }

  if (rawHref.startsWith("/l/?")) {
    return extractDuckDuckGoRedirectTarget(`https://duckduckgo.com${rawHref}`);
  }

  if (/^https?:\/\/duckduckgo\.com\/l\/\?/i.test(rawHref)) {
    return extractDuckDuckGoRedirectTarget(rawHref);
  }

  if (rawHref.startsWith("//")) {
    return normalizeExternalUrl(`https:${rawHref}`);
  }

  if (!/^https?:\/\//i.test(rawHref)) {
    return null;
  }

  return normalizeExternalUrl(rawHref);
}

function extractDuckDuckGoRedirectTarget(redirectUrl: string): string | null {
  try {
    const parsed = new URL(redirectUrl);
    const target = parsed.searchParams.get("uddg") ?? parsed.searchParams.get("rut");
    if (!target) {
      return null;
    }

    return normalizeExternalUrl(target);
  } catch {
    return null;
  }
}

function normalizeExternalUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();

    if (
      hostname.endsWith(".google.com") ||
      hostname === "google.com" ||
      hostname.endsWith(".duckduckgo.com") ||
      hostname === "duckduckgo.com"
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function extractSnippetForMatch(
  html: string,
  startIndex: number,
  patterns: RegExp[],
): string {
  const window = html.slice(startIndex, startIndex + SEARCH_WINDOW_CHARS);
  let snippetMatch: RegExpMatchArray | null = null;

  for (const pattern of patterns) {
    snippetMatch = window.match(pattern);
    if (snippetMatch) {
      break;
    }
  }

  if (!snippetMatch) {
    return "";
  }

  const snippet = cleanupText(snippetMatch[1]);
  if (snippet.length <= SEARCH_SNIPPET_CHARS) {
    return snippet;
  }

  return `${snippet.slice(0, SEARCH_SNIPPET_CHARS - 3)}...`;
}

function extractReadableText(html: string): string {
  const body = firstCapture(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i) ?? html;
  const withoutNoise = stripSections(body, ["script", "style", "noscript", "svg"]);
  const prioritized =
    firstCapture(withoutNoise, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ??
    firstCapture(withoutNoise, /<article\b[^>]*>([\s\S]*?)<\/article>/i) ??
    withoutNoise;
  const withoutLayout = stripSections(prioritized, [
    "nav",
    "header",
    "footer",
    "aside",
    "form",
  ]);
  const text = cleanupText(withoutLayout);

  if (text.length <= MAX_CONTENT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_CONTENT_CHARS - 3)}...`;
}

function firstCapture(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match?.[1] ?? null;
}

function stripSections(value: string, tagNames: string[]): string {
  let stripped = value;
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
    stripped = stripped.replace(pattern, " ");
  }
  return stripped;
}

function cleanupText(value: string): string {
  const withoutTags = value.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(withoutTags);
  const normalized = decoded
    .replace(/\r/g, " ")
    .replace(/\n+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();

  return normalized;
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(codePoint) ? "" : String.fromCodePoint(codePoint);
    }

    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(codePoint) ? "" : String.fromCodePoint(codePoint);
    }

    return namedEntities[entity] ?? "";
  });
}
