// The Claude client for pipeline jobs.
//
// In GitHub Actions it authenticates with Workload Identity Federation, so no API key
// exists anywhere: the job trades a GitHub OIDC token for a short-lived Anthropic one.
// GitHub's tokens are single-use (`jti`) and expire after ~5 minutes, while the SDK
// re-exchanges before its ~10-minute access token runs out, so every exchange asks
// GitHub for a fresh token rather than reusing one from a file.
//
// The federation rule only accepts tokens from this repo's `production` environment on
// `main`; the job needs `permissions: id-token: write` and the ANTHROPIC_* ids below
// (environment variables of the `production` environment). Locally, the SDK's default
// credential chain applies: `ant auth login` works, and no key is needed.

import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";
import { z } from "zod";

const API = "https://api.anthropic.com";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** A fresh GitHub OIDC token for the Anthropic audience. */
async function githubIdentityToken(): Promise<string> {
  const url = env("ACTIONS_ID_TOKEN_REQUEST_URL");
  const bearer = env("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  const res = await fetch(`${url}&audience=${encodeURIComponent(API)}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!res.ok)
    throw new Error(`GitHub OIDC token request failed: HTTP ${res.status}`);
  return z.object({ value: z.string().min(1) }).parse(await res.json()).value;
}

export function claudeClient(): Anthropic {
  // Only GitHub Actions jobs granted `id-token: write` have this variable.
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) return new Anthropic();
  return new Anthropic({
    credentials: oidcFederationProvider({
      identityTokenProvider: githubIdentityToken,
      federationRuleId: env("ANTHROPIC_FEDERATION_RULE_ID"),
      organizationId: env("ANTHROPIC_ORGANIZATION_ID"),
      serviceAccountId: env("ANTHROPIC_SERVICE_ACCOUNT_ID"),
      workspaceId: env("ANTHROPIC_WORKSPACE_ID"),
      baseURL: API,
      fetch,
    }),
  });
}
