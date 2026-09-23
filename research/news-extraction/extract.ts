// Test extraction of closure facts from news articles.
//
//   bun extract.ts                 # run all articles in data/articles.json
//   bun extract.ts --limit 5       # first N only
//
// Credentials come from ANTHROPIC_API_KEY (Bun loads .env automatically).
// Writes data/extractions.jsonl and prints token usage + estimated cost.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Extraction } from "./schema";

const MODEL = "claude-opus-5";
const PRICE_PER_MTOK = { input: 5, output: 25 };
const EFFORT = (process.env.EFFORT ?? "medium") as "low" | "medium" | "high";

type Article = {
  id: string;
  url: string;
  published: string;
  title: string;
  keywords: string;
  instagram_links: string[];
  text: string;
};

// Kept byte-stable so it caches across requests.
const SYSTEM = `You extract structured facts about Toronto food and drink businesses closing, moving, rebranding or reopening, from local news articles.

Rules:
- Only report businesses the article says closed, will close, moved, rebranded, changed owners or reopened. A business mentioned in passing is not an event.
- One entry per business location. A roundup article yields several entries.
- A one-day or short pause (sold out, holiday, renovation) is "temporary". A health-inspector shutdown is "temporary" with reason health_enforcement unless the article says it closed for good.
- If an editor's note or correction says the business is not closing after all, use status "retracted".
- If the business continues but stops operating as a restaurant at this location (delivery-only, wholesale-only), use "format_change".
- Non-food businesses (e.g. a home goods store) are still reported, with business_type "non_food", so they can be filtered out downstream.
- Resolve relative dates ("this Sunday", "end of the month") against the article's publication date.
- stated_reasons: only reasons the article attributes to someone (owner, landlord, official) or states as fact. Never speculate. Use "unknown" when no reason is given. Summaries must be your own words, 20 words or fewer; never copy article text.
- If the article reports no such event, set relevant=false and closures=[].`;

const client = new Anthropic();

async function extract(article: Article) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT, format: betaZodOutputFormat(Extraction) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Published: ${article.published}\nTitle: ${article.title}\nURL: ${article.url}\n\n${article.text}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`refused: ${response.stop_details?.category ?? "unknown"}`);
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error(`no parsed output (stop_reason=${response.stop_reason})`);
  }
  return { result: response.parsed_output, usage: response.usage, model: response.model };
}

const limitArg = process.argv.indexOf("--limit");
const articles: Article[] = await Bun.file("data/articles.json").json();
const batch = limitArg > 0 ? articles.slice(0, Number(process.argv[limitArg + 1])) : articles;

const out: string[] = [];
let inputTokens = 0;
let outputTokens = 0;
let failures = 0;

for (const article of batch) {
  try {
    const { result, usage, model } = await extract(article);
    inputTokens +=
      usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
    outputTokens += usage.output_tokens;
    out.push(JSON.stringify({ id: article.id, url: article.url, model, ...result }));
    console.log(`${article.id} ok  ${result.closures.map((c) => `${c.name} [${c.event_type}]`).join(", ") || "(none)"}`);
  } catch (error) {
    failures++;
    if (error instanceof Anthropic.RateLimitError) console.error(`${article.id} rate limited`);
    else if (error instanceof Anthropic.APIError) console.error(`${article.id} API error ${error.status}: ${error.message}`);
    else console.error(`${article.id} failed: ${(error as Error).message}`);
  }
}

await Bun.write("data/extractions.jsonl", out.join("\n") + "\n");

const cost = (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1e6;
const done = batch.length - failures;
console.log(`\n${done}/${batch.length} extracted, effort=${EFFORT}`);
console.log(`input ≈ ${Math.round(inputTokens)} tok (cache-weighted), output ${outputTokens} tok`);
console.log(`cost ≈ $${cost.toFixed(3)}  (≈ $${(cost / Math.max(done, 1)).toFixed(4)}/article)`);
