// Checks the Claude API is reachable with the pipeline's credentials: in GitHub Actions,
// Workload Identity Federation (see claude.ts); locally, your `ant auth login`.
//
//   bun run claude:check
//
// Counts tokens (free), then makes one tiny request (a fraction of a cent) to confirm
// the credentials are allowed to run inference.

import { claudeClient } from "./claude";

const MODEL = "claude-opus-5";
const client = claudeClient();

const counted = await client.messages.countTokens({
  model: MODEL,
  messages: [{ role: "user", content: "Reply with OK." }],
});
console.log(`count_tokens: ${counted.input_tokens} input tokens`);

const reply = await client.messages.create({
  model: MODEL,
  max_tokens: 256,
  output_config: { effort: "low" },
  messages: [{ role: "user", content: "Reply with OK." }],
});
const text = reply.content
  .flatMap((block) => (block.type === "text" ? [block.text] : []))
  .join("")
  .trim();
console.log(
  `messages.create: ${reply.stop_reason}, "${text}" (${reply.usage.input_tokens} in, ${reply.usage.output_tokens} out)`,
);
