# ADR-0024: Anthropic Secret Injection for ICP Agent Runtime

## Status
Accepted

## Context
LAT-67 needs `ANTHROPIC_API_KEY` to perform the live Anthropic `/v1/messages` proof. The key must be injected into the ICP agent runtime without being committed to the repository.

## Decision
The approved runtime injection method for `ANTHROPIC_API_KEY` is:

1. **Secret residence:** `.env` file at repository root (`.env` in `.gitignore`)
2. **Injection surface:** Environment variable passed to ICP agent subprocess via `subprocess.run(env={...})`
3. **Fail-fast:** If `ANTHROPIC_API_KEY` is not set, the ICP runner refuses dispatch with error: `ANTHROPIC_API_KEY not set`
4. **Sanitization:** Log wrapper strips the key value before writing to logs, PR bodies, run reports, and evidence artifacts

## Configuration

```bash
# In .env (not committed):
ANTHROPIC_API_KEY=sk-ant-...

# In GitHub Actions secrets:
ANTHROPIC_API_KEY (GitHub secret)
```

## Verification
- Missing key → exit with code 1, message: "ANTHROPIC_API_KEY not set"
- Present key → available as `os.environ["ANTHROPIC_API_KEY"]` in the ICP runner process
- Logs → no raw key value or fragments emitted

## Non-Goals
- Long-term provider strategy (Bedrock, cloud secrets manager)
- Real credential commitment to repository
- Production-grade secrets manager for first proof

## References
- LAT-69: Configure approved Anthropic secret injection for ICP agent runtime
- LAT-67: Live Anthropic /v1/messages proof
- ADR-0013: Direct-Path Operations
- ADR-0017: [to be numbered]
