// Pure parsing for the news crawl: sitemap entries from blogTO and Daily Hive, the
// closure-wording classifier, and Dickison's weekly OPEN/CLOSED roundups.

import { parseStreetAddress } from "./address";

export type SitemapEntry = {
  url: string;
  /** blogTO's publish date. Daily Hive's sitemap only has a last-modified time, so null there. */
  publishedAt: string | null;
  title: string | null;
  /** The URL's last path segment. */
  slug: string;
};

function unescapeXml(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex: string, code: string) =>
      String.fromCharCode(parseInt(code, hex ? 16 : 10)),
    );
}

/** Every `<loc>` in a sitemap or sitemap index. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    unescapeXml(m[1] ?? ""),
  );
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
  return match?.[1] ? unescapeXml(match[1]) : null;
}

export function sitemapEntries(
  xml: string,
  publishDates: boolean,
): SitemapEntry[] {
  return xml
    .split("<url>")
    .slice(1)
    .flatMap((block) => {
      const url = tag(block, "loc");
      if (!url) return [];
      const slug =
        new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
      return [
        {
          url,
          slug,
          title: tag(block, "news:title"),
          publishedAt: publishDates
            ? tag(block, "news:publication_date")
            : null,
        },
      ];
    });
}

const CLOSURE =
  /\b(clos(e|es|ed|ing|ure|ures)|shut(s|ting)?[ _-]?down|shuts|shutting|last[ _-]day|final[ _-](day|service|night|week)|farewell|goodbye|calls?[ _-]it[ _-]quits|end[ _-]of[ _-]an[ _-]era|gone[ _-]for[ _-]good|permanently|rip)\b/i;
const FOOD =
  /\b(restaurants?|bars?|cafes?|caf%C3%A9|bakery|bakeries|pubs?|eateries|eatery|bistro|diner|pizzeria|pizza|sushi|ramen|brunch|patio|brewery|taverna|steakhouse|kitchen|grill|noodles?|burgers?|bbq|tacos?|dim[ _-]sum|food|eats?|dining|cocktail|coffee|bagels?|deli)\b/i;
/** Still in the future: "is closing", "to close", as opposed to "has closed". */
const ANNOUNCED =
  /\b(closing|will[ _-]close|to[ _-]close|shutting[ _-]down|set[ _-]to[ _-]close|last[ _-](day|night|week))\b/i;
/** "10 Toronto restaurants that closed in 2023": one article naming many places. */
const ROUNDUP =
  /^(\d{2,3}|(\d{1,2}(?=\s|-(?!eleven)\D+s\b)))[-\s]|^(best|top|these|every)\b|\b(this[ _-]year|so[ _-]far|roundup)\b/i;

export type Classified = {
  kind: "single" | "roundup";
  claim: "closed" | "announced";
};

/** A food-related article with closure wording in its title or slug, or null. */
export function classify(entry: {
  url: string;
  title: string | null;
  slug: string;
}): Classified | null {
  const text = `${entry.title ?? ""} ${entry.slug.replaceAll(/[-_]/g, " ")}`;
  const path = new URL(entry.url).pathname;
  const isFood =
    path.includes("/eat_drink/") ||
    path.includes("/food-drink") ||
    FOOD.test(text);
  if (!isFood || !CLOSURE.test(text)) return null;
  return {
    kind:
      ROUNDUP.test(entry.slug) || ROUNDUP.test(entry.title ?? "")
        ? "roundup"
        : "single",
    claim: ANNOUNCED.test(text) ? "announced" : "closed",
  };
}

/** "the-bar-jokbal-night-market" → "The Bar Jokbal Night Market". */
export function titleFromSlug(slug: string): string {
  const words = slug.replaceAll(/[-_]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Dickison's roundups ------------------------------------------------------------------

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "…-news-may-28-june-3-2026" → 2026-05-28. Null for the few slugs without a year. */
export function roundupWeekStart(url: string): string | null {
  const match =
    /-news-([a-z]+)-(\d{1,2})(?:-[a-z]+)?(?:-\d{1,2})?-(\d{4})$/.exec(url);
  if (!match) return null;
  const [, month = "", day = "", year = ""] = match;
  const m = MONTHS.indexOf(month) + 1;
  return m
    ? `${year}-${String(m).padStart(2, "0")}-${day.padStart(2, "0")}`
    : null;
}

function decodeHtml(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    );
}

/** The paragraphs of the post body, with tags removed. */
function paragraphs(html: string): string[] {
  const stripped = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  return stripped
    .slice(stripped.indexOf("sqs-html-content"))
    .split(/<\/(?:p|h\d|li)>/)
    .map((part) =>
      decodeHtml(part.replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/** Section headings are short all-caps lines: OPEN, CLOSED, CHANGES, EVENTS, NEWS… */
const HEADING = /^[A-Z][A-Z/&' +!-]{2,24}$/;

function closedSection(lines: string[]): string[] {
  const start = lines.indexOf("CLOSED");
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

const ADDRESS = /\((\d+[A-Za-z]?(?:-\d+)?\s[^)]{3,60})\)/g;

/** A closed place as the roundup names it: an address, and the words before it as a rough name. */
export type Mention = {
  /** As written, minus periods: "195 Dundas St W". */
  address: string;
  /** Normalized by address.ts, to match address_points.match_key. */
  key: string;
  /** The words before the address; contains the name, plus whatever else the sentence says. */
  guess: string;
};

export type Roundup = {
  title: string | null;
  /** Whether a CLOSED section was found; false means the page layout isn't what we expect. */
  hasClosed: boolean;
  mentions: Mention[];
};

/** Facts only: the addresses in the CLOSED section. No article text is kept. */
export function parseRoundup(html: string): Roundup {
  const section = closedSection(paragraphs(html));
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  const mentions = section.flatMap((paragraph) =>
    [...paragraph.matchAll(ADDRESS)].flatMap((match) => {
      const address = (match[1] ?? "").replace(/\./g, "").replace(/,\s*$/, "");
      const parsed = parseStreetAddress(address);
      if (!parsed) return [];
      const before =
        paragraph
          .slice(0, match.index)
          .split(/[.:;!?]\s/)
          .at(-1) ?? "";
      return [
        {
          address,
          key: parsed.key,
          guess: before.trim().split(/\s+/).slice(-12).join(" "),
        },
      ];
    }),
  );
  return {
    title: title ? decodeHtml(title).replace(/\s+—.*$/, "") : null,
    hasClosed: section.length > 0,
    mentions,
  };
}
