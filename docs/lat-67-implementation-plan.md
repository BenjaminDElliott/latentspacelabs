# LAT-67: Direct Anthropic Invocation Proof - Implementation Plan

## Goal
Implement a minimal DirectProviderClient that calls Anthropic `/v1/messages` with claude-3-haiku-20240307.

## Plan
1. Create `packages/icp/src/providers/direct-provider.ts` with minimal client
2. Read `ANTHROPIC_API_KEY` from env (no config-file fallback)
3. Call `POST /v1/messages` with `claude-3-haiku-20240307`, `max_tokens: 16`, prompt `ping`
4. Write E1 evidence artifact with provider/model/status/tokens/latency/cost-band/secret_source
5. Ensure LAT-66 cost-band gate passes
6. No secret values printed, committed, logged, or artifacted
