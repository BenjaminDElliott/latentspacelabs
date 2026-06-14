/**
 * Output redaction for the LAT-129 dispatcher.
 *
 * The dispatcher captures stdout/stderr from the control-loop child
 * process before writing any of it back to Linear. The set of patterns
 * here is deliberately conservative: known token prefixes (Linear,
 * GitHub, OpenAI, Anthropic, generic Bearer), endpoint URLs, RunPod pod
 * identifiers, and any value supplied via `extraSecrets` (typically the
 * RunPod / VLLM keys present in process.env at dispatch time).
 *
 * This is *not* the primary secret-handling control — secrets are kept
 * out of arguments and environment by the orchestration in
 * `dispatch.ts`. Redaction is the belt-and-braces guard against a
 * misbehaving child process echoing a token into stderr or a log file.
 *
 * Pure module: no I/O, no process.env reads.
 */

const DEFAULT_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /lin_api_[A-Za-z0-9_\-]+/g,
  /ghp_[A-Za-z0-9_\-]+/g,
  /github_pat_[A-Za-z0-9_\-]+/g,
  /agp_[A-Za-z0-9_\-]+/g,
  /sk-[A-Za-z0-9_\-]{16,}/g,
  /sk-ant-[A-Za-z0-9_\-]+/g,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
];

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>`]+/g;

/**
 * Heuristic for opaque RunPod pod identifiers that surface in CLI output
 * (e.g. `pod_abcd1234efgh5678`). Conservative — matches the documented
 * RunPod prefix only.
 */
const POD_ID_PATTERN = /\bpod_[A-Za-z0-9]{6,}\b/g;

export interface RedactOptions {
  /**
   * Extra secret-shaped values to scrub literally. Typically the runtime
   * resolves these from env (RUNPOD_API_KEY, RUNPOD_VLLM_API_KEY, the
   * Linear API key, etc.) at the dispatcher boundary; redaction never
   * reads process.env itself.
   */
  extraSecrets?: ReadonlyArray<string>;
  /**
   * If true, replace any URL-shaped substring with `<redacted-url>`. The
   * dispatcher leaves URLs intact for `linear.app` only; everything else
   * (RunPod, vendor inference endpoints) collapses.
   */
  redactNonLinearUrls?: boolean;
}

const URL_KEEP_HOSTS: ReadonlyArray<string> = ['linear.app', 'github.com'];

export function redactOutput(message: string, opts: RedactOptions = {}): string {
  if (typeof message !== 'string' || message.length === 0) return '';

  let out = message;

  // Literal extra secret values first; deduplicate empties.
  if (opts.extraSecrets) {
    for (const literal of opts.extraSecrets) {
      if (typeof literal !== 'string' || literal.length < 8) continue;
      const escaped = escapeRegExp(literal);
      out = out.replace(new RegExp(escaped, 'g'), '<redacted>');
    }
  }

  for (const pat of DEFAULT_TOKEN_PATTERNS) {
    out = out.replace(pat, '<redacted>');
  }

  out = out.replace(POD_ID_PATTERN, '<redacted-pod-id>');

  if (opts.redactNonLinearUrls !== false) {
    out = out.replace(URL_PATTERN, (match) => {
      try {
        const u = new URL(match);
        if (URL_KEEP_HOSTS.some((h) => u.host === h || u.host.endsWith('.' + h))) {
          return match;
        }
      } catch {
        // fall through
      }
      return '<redacted-url>';
    });
  }

  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
