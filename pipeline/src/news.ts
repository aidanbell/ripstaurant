// News crawl (Phase 5): finds closure coverage on blogTO, Daily Hive and Stephanie
// Dickison's Toronto Restaurants, stores each article as a `sources` row, and links them to
// closure events as `evidence` for review. All three publishers have given written
// permission; the crawl is polite (polite.ts: one request at a time per host, 5+ seconds
// apart, robots.txt honoured).
//
//   bun run news                    # what's new: the newest sitemap pages and roundups
//   bun run news --backfill         # all history (~450 requests, about 45 minutes)
//   bun run news --only link        # re-link stored sources, no requests
//
// 1. sitemaps    blogTO and Daily Hive article sitemaps → sources, for entries that look like
//                food closures by title or slug (news-parse.ts). No article page is fetched.
// 2. roundups    Dickison's weekly OPEN/CLOSED posts → a source each, plus an extraction of the
//                addresses in its CLOSED section. Facts only; no article text is kept.
// 3. link        addresses and slugs → closure events and establishments → evidence rows.
//
// Extraction here is rules, not a model: it finds who closed where, and roughly when (the
// roundup week or the publish date). It doesn't read reasons, last days or years in business.
// Evidence rows are `auto` (address and name agree, and the dates fit) or `review`.

import type { TransactionSQL } from "bun";
import { sql } from "@ripstaurant/db";
import { count, runJob } from "./job";
import type { Step } from "./job";
import { nameKey, nameSimilarity, sharesDistinctiveWord } from "./names";
import {
  classify,
  parseRoundup,
  roundupWeekStart,
  sitemapEntries,
  sitemapLocs,
  titleFromSlug,
} from "./news-parse";
import type { Mention } from "./news-parse";
import { PoliteFetcher } from "./polite";

const BLOGTO = "blogTO";
const DAILY_HIVE = "Daily Hive";
const DICKISON = "Toronto Restaurants (Stephanie Dickison)";

const TERMS_NOTE =
  "Crawled with the publisher's written permission: one request at a time, 5+ seconds apart. Only the title, URL and extracted facts are stored.";
/** Bumped when the rules change, so old extractions can be told from new. */
const ROUNDUP_VERSION = "dickison-closed-v1";

/** Our coverage starts 2022-03-01; a roundup from the month before can still name a place that ended then. */
const ROUNDUPS_SINCE = "2022-02-01";
/** A routine run reads this many of the newest sitemap pages, and roundups. */
const NEW_SITEMAP_PAGES = 2;
const NEW_ROUNDUPS = 30;
const BATCH = 1000;

const fetcher = new PoliteFetcher({
  cacheDir: new URL("../../data/crawl/cache", import.meta.url).pathname,
});

type NewSource = {
  publisher: string;
  url: string;
  title: string;
  publishedAt: string | null;
  author?: string;
};

/** Inserts sources that aren't stored yet (by URL); returns just those. */
async function insertSources(
  tx: TransactionSQL | typeof sql,
  cityId: string,
  rows: NewSource[],
): Promise<{ id: string; url: string }[]> {
  const inserted: { id: string; url: string }[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((row) => ({
      city_id: cityId,
      kind: "news_article",
      publisher: row.publisher,
      url: row.url,
      title: row.title,
      author: row.author ?? null,
      published_at: row.publishedAt,
      retrieved_at: new Date(),
      terms_note: TERMS_NOTE,
    }));
    const done: { id: string; url: string }[] = await tx`
      insert into sources ${sql(batch)}
      on conflict (url) do nothing
      returning id, url
    `;
    inserted.push(...done);
  }
  return inserted;
}

// 1. Sitemaps --------------------------------------------------------------------------

type Crawled = { sources: NewSource[]; urls: number };

/** blogTO's article pages run oldest to newest, so the last ones are the new ones. */
async function crawlBlogto(backfill: boolean): Promise<Crawled> {
  const index = sitemapLocs(
    await fetcher.text("https://www.blogto.com/sitemap.xml"),
  );
  const pages = index.filter((url) => url.includes("sitemap-articles.xml"));
  const sources: NewSource[] = [];
  let urls = 0;
  for (const page of backfill ? pages : pages.slice(-NEW_SITEMAP_PAGES)) {
    const entries = sitemapEntries(await fetcher.text(page), true);
    urls += entries.length;
    for (const entry of entries) {
      if (!classify(entry)) continue;
      sources.push({
        publisher: BLOGTO,
        url: entry.url,
        title: entry.title ?? titleFromSlug(entry.slug),
        publishedAt: entry.publishedAt,
      });
    }
  }
  return { sources, urls };
}

/** Daily Hive's page 1 is the newest. Its sitemap has no titles or publish dates, only the slug. */
async function crawlDailyHive(backfill: boolean): Promise<Crawled> {
  const index = sitemapLocs(
    await fetcher.text("https://dailyhive.com/sitemap.xml"),
  );
  const sources: NewSource[] = [];
  let urls = 0;
  for (const page of backfill ? index : index.slice(0, NEW_SITEMAP_PAGES)) {
    const entries = sitemapEntries(await fetcher.text(page), false).filter(
      (entry) => entry.url.startsWith("https://dailyhive.com/toronto/"),
    );
    urls += entries.length;
    for (const entry of entries) {
      if (!classify(entry)) continue;
      sources.push({
        publisher: DAILY_HIVE,
        url: entry.url,
        title: titleFromSlug(entry.slug),
        publishedAt: null,
      });
    }
  }
  return { sources, urls };
}

const sitemaps: Step = {
  name: "sitemaps",
  run: async (cityId, _store, { backfill }) => {
    // Different hosts, so these can overlap without either getting busier.
    const [blogto, dailyHive] = await Promise.all([
      crawlBlogto(backfill),
      crawlDailyHive(backfill),
    ]);
    const inserted = await insertSources(sql, cityId, [
      ...blogto.sources,
      ...dailyHive.sources,
    ]);
    return `blogTO ${count(blogto.sources.length)} of ${count(blogto.urls)} URLs, Daily Hive ${count(dailyHive.sources.length)} of ${count(dailyHive.urls)} look like closures; ${count(inserted.length)} new`;
  },
};

// 2. Dickison's roundups ---------------------------------------------------------------

const roundups: Step = {
  name: "roundups",
  run: async (cityId, _store, { backfill }) => {
    const sitemap = await fetcher.text(
      "https://www.stephaniedickison.com/sitemap.xml",
    );
    const all = sitemapLocs(sitemap)
      .filter((url) => /\/articles\/open-closed-[a-z-]*news-/.test(url))
      .flatMap((url) => {
        const week = roundupWeekStart(url);
        return week && week >= ROUNDUPS_SINCE ? [{ url, week }] : [];
      })
      .sort((a, b) => b.week.localeCompare(a.week));

    if (!all.length) return "no roundups in the sitemap";
    const known: { url: string }[] = await sql`
      select url from sources where url in ${sql(all.map((r) => r.url))}
    `;
    const stored = new Set(known.map((row) => row.url));
    const todo = all.filter((r) => !stored.has(r.url));

    let mentions = 0;
    let withoutClosed = 0;
    let done = 0;
    for (const roundup of backfill ? todo : todo.slice(0, NEW_ROUNDUPS)) {
      let html: string;
      try {
        html = await fetcher.text(roundup.url);
      } catch (error) {
        // A listed page that has gone is skipped, not retried forever by failing the run.
        if (String(error).includes("HTTP 404")) continue;
        throw error;
      }
      const parsed = parseRoundup(html);
      if (!parsed.hasClosed) withoutClosed++;
      mentions += parsed.mentions.length;
      await sql.begin(async (tx) => {
        const [source] = await insertSources(tx, cityId, [
          {
            publisher: DICKISON,
            url: roundup.url,
            title:
              parsed.title ??
              titleFromSlug(roundup.url.split("/").at(-1) ?? ""),
            // Roundups run Thursday to Wednesday and post on the Thursday.
            publishedAt: roundup.week,
            author: "Stephanie Dickison",
          },
        ]);
        if (!source) return;
        await tx`
          insert into source_extractions (source_id, extractor, prompt_version, extracted_json)
          values (${source.id}, 'rules', ${ROUNDUP_VERSION},
                  ${{ hasClosed: parsed.hasClosed, mentions: parsed.mentions }})
        `;
      });
      done++;
    }
    const left = todo.length - done;
    return `${count(done)} roundups read (${count(mentions)} closed addresses${withoutClosed ? `, ${withoutClosed} without a CLOSED section` : ""}); ${count(left)} left`;
  },
};

// 3. Linking ---------------------------------------------------------------------------

type Evidence = {
  source_id: string;
  closure_event_id: string | null;
  establishment_id: string;
  claim: "closed" | "announced";
  match_status: "auto" | "review";
  note: string;
};

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

type Place = {
  establishment_id: string;
  name: string;
  event_id: string | null;
  /** The occupancy's last sighting, and the event's closure window; ISO dates. */
  last_seen: string | null;
  earliest: string | null;
  latest: string | null;
};

/** When a place stopped, as far as we know: the window of its closure event, else its last sighting. */
function span(place: Place): [string, string] | null {
  const from = place.earliest ?? place.last_seen ?? place.latest;
  const to = place.latest ?? place.last_seen ?? place.earliest;
  return from && to ? [from, to] : null;
}

/** A roundup lists closures from about the week they happened, a little before or well after. */
function weekFits(week: string, place: Place): boolean {
  const range = span(place);
  return (
    !!range && week >= addDays(range[0], -60) && week <= addDays(range[1], 120)
  );
}

type DickisonRow = {
  source_id: string;
  week: string;
  extracted_json: { mentions: Mention[] };
};

async function linkDickison(
  cityId: string,
): Promise<{ evidence: Evidence[]; mentions: number; unmatched: number }> {
  const rows: DickisonRow[] = await sql`
    select s.id as source_id, s.published_at::date::text as week, x.extracted_json
    from sources s join source_extractions x on x.source_id = s.id
    where s.city_id = ${cityId} and s.publisher = ${DICKISON} and x.prompt_version = ${ROUNDUP_VERSION}
  `;
  const keys = [
    ...new Set(
      rows.flatMap((r) => r.extracted_json.mentions.map((m) => m.key)),
    ),
  ];
  const byKey = new Map<string, Place[]>();
  if (keys.length) {
    // 'nearby' matches don't count: 219 and 217 are different places.
    const places: (Place & { key: string })[] = await sql`
      select ap.match_key as key, o.establishment_id, e.canonical_name as name, ce.id as event_id,
             o.last_seen::text as last_seen,
             ce.closed_on_earliest::text as earliest, ce.closed_on_latest::text as latest
      from address_points ap
      join locations l on l.address_point_id = ap.id and l.address_match <> 'nearby'
      join occupancies o on o.location_id = l.id
      join establishments e on e.id = o.establishment_id
      left join closure_events ce on ce.occupancy_id = o.id and ce.status in ('announced', 'closed')
      where ap.city_id = ${cityId} and ap.removed_at is null and ap.match_key in ${sql(keys)}
    `;
    for (const place of places)
      byKey.set(place.key, [...(byKey.get(place.key) ?? []), place]);
  }

  const evidence: Evidence[] = [];
  let mentions = 0;
  let unmatched = 0;
  for (const row of rows) {
    for (const mention of row.extracted_json.mentions) {
      mentions++;
      const places = byKey.get(mention.key) ?? [];
      let linked = false;
      for (const place of places) {
        const named =
          nameSimilarity(place.name, mention.guess) >= 0.5 ||
          sharesDistinctiveWord(place.name, mention.guess);
        const fits = weekFits(row.week, place);
        // Without a closure event there is nothing to attach to but the establishment, and only
        // when the name and the timing agree; otherwise this is a different tenant.
        if (!place.event_id && !(named && fits)) continue;
        if (place.event_id && !named && !fits) continue;
        linked = true;
        evidence.push({
          source_id: row.source_id,
          closure_event_id: place.event_id,
          establishment_id: place.establishment_id,
          claim: "closed",
          match_status: place.event_id && named && fits ? "auto" : "review",
          note: `Dickison roundup ${row.week}: ${mention.address}${place.event_id ? "" : " (no closure event yet)"}`,
        });
      }
      if (!linked) unmatched++;
    }
  }
  return { evidence, mentions, unmatched };
}

type BlogtoRow = {
  source_id: string;
  url: string;
  title: string;
  published: string;
};

/** Matches by name: every distinctive word of an establishment's name is in the slug, and the dates fit. */
async function linkBlogto(
  cityId: string,
): Promise<{ evidence: Evidence[]; singles: number }> {
  const articles: BlogtoRow[] = await sql`
    select id as source_id, url, title, published_at::date::text as published
    from sources where city_id = ${cityId} and publisher = ${BLOGTO} and published_at is not null
  `;
  const places: Place[] = await sql`
    select o.establishment_id, e.canonical_name as name, ce.id as event_id,
           o.last_seen::text as last_seen,
           ce.closed_on_earliest::text as earliest, ce.closed_on_latest::text as latest
    from closure_events ce
    join occupancies o on o.id = ce.occupancy_id
    join establishments e on e.id = o.establishment_id
    where e.city_id = ${cityId} and ce.status in ('announced', 'closed')
  `;

  const byWord = new Map<string, Place[]>();
  const keyOf = new Map<Place, string[]>();
  for (const place of places) {
    const words = nameKey(place.name).split(" ").filter(Boolean);
    // One short word ("Pho", "Bar") would match half the slugs.
    if (!words.length || !sharesDistinctiveWord(place.name, place.name))
      continue;
    if (words.length === 1 && (words[0]?.length ?? 0) < 5) continue;
    keyOf.set(place, words);
    for (const word of words)
      byWord.set(word, [...(byWord.get(word) ?? []), place]);
  }

  const evidence: Evidence[] = [];
  let singles = 0;
  for (const article of articles) {
    const slug = article.url.split("/").filter(Boolean).at(-1) ?? "";
    const claimed = classify({ url: article.url, title: article.title, slug });
    if (claimed?.kind !== "single") continue;
    singles++;
    const slugWords = new Set(
      nameKey(slug.replaceAll(/[-_]/g, " ")).split(" "),
    );
    const seen = new Set<Place>();
    for (const word of slugWords) {
      for (const place of byWord.get(word) ?? []) {
        if (seen.has(place)) continue;
        seen.add(place);
        if (!keyOf.get(place)?.every((w) => slugWords.has(w))) continue;
        const range = span(place);
        // Coverage runs from announcement, before the last day, to a write-up well after it.
        if (!range || article.published < addDays(range[0], -150)) continue;
        if (article.published > addDays(range[1], 240)) continue;
        evidence.push({
          source_id: article.source_id,
          closure_event_id: place.event_id,
          establishment_id: place.establishment_id,
          claim: claimed.claim,
          match_status: "review",
          note: `blogTO title and name agree; published ${article.published}`,
        });
      }
    }
  }
  return { evidence, singles };
}

const link: Step = {
  name: "link",
  run: async (cityId) => {
    const dickison = await linkDickison(cityId);
    const blogto = await linkBlogto(cityId);
    const rows = [...dickison.evidence, ...blogto.evidence];
    // One row per source, subject and claim.
    const unique = new Map<string, Evidence>();
    for (const row of rows) {
      const key = `${row.source_id}|${row.closure_event_id ?? `e${row.establishment_id}`}|${row.claim}`;
      const kept = unique.get(key);
      if (
        !kept ||
        (kept.match_status === "review" && row.match_status === "auto")
      )
        unique.set(key, row);
    }

    await sql.begin(async (tx) => {
      // Re-linking replaces this job's own unreviewed rows; confirmed and rejected rows stay,
      // and are skipped by the inserts below.
      await tx`
        delete from evidence ev using sources s
        where ev.source_id = s.id and s.city_id = ${cityId} and s.kind = 'news_article'
          and ev.match_status in ('auto', 'review')
          and not exists (select 1 from closure_reasons cr where cr.evidence_id = ev.id)
      `;
      const all = [...unique.values()];
      for (let i = 0; i < all.length; i += BATCH) {
        await tx`
          insert into evidence ${sql(all.slice(i, i + BATCH))}
          on conflict do nothing
        `;
      }
    });

    const auto = [...unique.values()].filter(
      (r) => r.match_status === "auto",
    ).length;
    return `Dickison ${count(dickison.mentions)} closed addresses: ${count(dickison.evidence.length)} linked, ${count(dickison.unmatched)} not in our data; blogTO ${count(blogto.singles)} single-venue articles: ${count(blogto.evidence.length)} possible matches; ${count(unique.size)} evidence rows (${count(auto)} auto, ${count(unique.size - auto)} review)`;
  },
};

await runJob([sitemaps, roundups, link]);
