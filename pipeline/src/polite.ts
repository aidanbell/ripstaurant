// A polite HTTP fetcher for crawling news sites we have permission to read: one request
// at a time per host, a delay with jitter between requests, robots.txt honoured, backoff
// on 429/5xx (Retry-After respected), and an abort after repeated failures. Responses are
// cached on disk, so a re-run or a resumed backfill never asks a site for the same URL twice.

import { CryptoHasher, gunzipSync, gzipSync } from "bun";
import { USER_AGENT } from "./ckan";

export type PoliteOptions = {
  /** Where responses are cached (gzipped), one file per URL. */
  cacheDir: string;
  /** Minimum gap between requests to one host. A robots.txt Crawl-delay raises it. */
  delayMs?: number;
  /** Random extra gap, up to this much. */
  jitterMs?: number;
  /** Consecutive failed requests (after retries) that abort the run. */
  maxFailures?: number;
};

type HostState = {
  host: string;
  /** When the next request to this host may start. */
  nextAt: number;
  delayMs: number;
  disallow: string[];
  /** Serializes requests to the host. */
  tail: Promise<unknown>;
};

const RETRIES = 3;

class HttpError extends Error {
  constructor(status: number, url: string) {
    super(`HTTP ${status} fetching ${url}`);
  }
}

export class PoliteFetcher {
  readonly requests = new Map<string, number>();
  private readonly hosts = new Map<string, Promise<HostState>>();
  private failures = 0;

  constructor(private readonly opts: PoliteOptions) {}

  /** The body of `url`, from the cache or the network. Throws if robots.txt disallows it. */
  async text(url: string): Promise<string> {
    const path = this.cachePath(url);
    const cached = Bun.file(path);
    if (await cached.exists())
      return new TextDecoder().decode(gunzipSync(await cached.bytes()));

    const state = await this.host(new URL(url).host);
    if (!this.allowed(state, url))
      throw new Error(`robots.txt disallows ${url}`);
    const body = await this.request(state, url);
    await Bun.write(path, gzipSync(new TextEncoder().encode(body)));
    return body;
  }

  private cachePath(url: string): string {
    const hash = new CryptoHasher("sha256")
      .update(url)
      .digest("hex")
      .slice(0, 16);
    const { host, pathname } = new URL(url);
    const name = pathname.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
    return `${this.opts.cacheDir}/${host}/${name}-${hash}.gz`;
  }

  /** The host's state, loading its robots.txt once; later callers share the same load. */
  private host(host: string): Promise<HostState> {
    const known = this.hosts.get(host);
    if (known) return known;
    const loading = this.loadHost(host);
    this.hosts.set(host, loading);
    return loading;
  }

  private async loadHost(host: string): Promise<HostState> {
    const state: HostState = {
      host,
      nextAt: 0,
      delayMs: this.opts.delayMs ?? 5000,
      disallow: [],
      tail: Promise.resolve(),
    };
    try {
      const robots = await this.request(state, `https://${host}/robots.txt`);
      const { disallow, crawlDelaySecs } = parseRobots(robots);
      state.disallow = disallow;
      if (crawlDelaySecs)
        state.delayMs = Math.max(state.delayMs, crawlDelaySecs * 1000);
    } catch (error) {
      // A missing robots.txt means no rules; any other failure shouldn't be read as "allowed".
      if (!String(error).includes("HTTP 404")) throw error;
    }
    return state;
  }

  private allowed(state: HostState, url: string): boolean {
    const { pathname, search } = new URL(url);
    return !state.disallow.some((rule) => matchesRule(rule, pathname + search));
  }

  /** One request at a time per host, spaced out; retried with backoff on 429 and 5xx. */
  private request(state: HostState, url: string): Promise<string> {
    const run = state.tail.then(() => this.attempt(state, url));
    state.tail = run.catch(() => undefined);
    return run;
  }

  private async attempt(state: HostState, url: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      if (this.failures >= (this.opts.maxFailures ?? 5))
        throw new Error(`aborting: ${this.failures} failed requests in a row`);
      const wait = state.nextAt - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      const jitter = Math.random() * (this.opts.jitterMs ?? 2000);
      state.nextAt = Date.now() + state.delayMs + jitter;
      this.requests.set(state.host, (this.requests.get(state.host) ?? 0) + 1);

      let retryAfterMs = 0;
      let failure: string;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" },
          signal: AbortSignal.timeout(60_000),
        });
        if (res.ok) {
          this.failures = 0;
          return await res.text();
        }
        // Other 4xx are answers, not outages; they don't count toward the abort.
        if (res.status !== 429 && res.status < 500)
          throw new HttpError(res.status, url);
        retryAfterMs = Number(res.headers.get("retry-after") ?? 0) * 1000;
        failure = `HTTP ${res.status}`;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        failure = String(error);
      }
      this.failures++;
      if (attempt >= RETRIES) throw new Error(`${failure} fetching ${url}`);
      const backoff = Math.max(retryAfterMs, 2 ** attempt * 15_000);
      console.warn(
        `${failure} for ${url}; retrying in ${Math.round(backoff / 1000)}s`,
      );
      state.nextAt = Date.now() + backoff;
    }
  }
}

/** The `*` group's Disallow rules and Crawl-delay; other groups name specific bots. */
export function parseRobots(text: string): {
  disallow: string[];
  crawlDelaySecs: number;
} {
  const disallow: string[] = [];
  let crawlDelaySecs = 0;
  let inStarGroup = false;
  let lastWasAgent = false;
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0]?.trim() ?? "";
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      inStarGroup = lastWasAgent ? inStarGroup || value === "*" : value === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStarGroup) continue;
    if (field === "disallow" && value) disallow.push(value);
    if (field === "crawl-delay") crawlDelaySecs = Number(value) || 0;
  }
  return { disallow, crawlDelaySecs };
}

/** A robots.txt rule: a path prefix, with `*` wildcards and a trailing `$` anchor. */
function matchesRule(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}
