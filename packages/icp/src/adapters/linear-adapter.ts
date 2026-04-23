/**
 * Linear adapter (ADR-0012 § "Linear adapter").
 *
 * The first slice of the ICP does not carry a real Linear GraphQL client — the
 * Linear credential management ticket (ADR-0008 open question 4) lands
 * separately. This module ships the adapter interface plus a stub
 * implementation used by tests and by the CLI's `--stub` path for local
 * exercise of the dispatch skill. A production Linear client will swap in here
 * without changing the skill runner or the dispatch skill.
 */
import type {
  LinearAdapter,
  LinearIssueSnapshot,
} from "../runtime/contract.js";

export interface StubLinearAdapterOptions {
  /** Pre-seeded issues, keyed by LAT-* id. */
  issues: Readonly<Record<string, LinearIssueSnapshot>>;
  /** Collects every comment posted via the adapter. */
  commentSink?: (c: { issueId: string; body: string; url: string }) => void;
}

export function createStubLinearAdapter(
  opts: StubLinearAdapterOptions,
): LinearAdapter {
  let counter = 0;
  return {
    async readIssue(id: string): Promise<LinearIssueSnapshot> {
      const snap = opts.issues[id];
      if (!snap) throw new Error(`stub linear adapter: unknown issue ${id}`);
      return snap;
    },
    async postComment(issueId: string, body: string) {
      counter += 1;
      const url = `https://linear.app/stub/issue/${issueId}/comment/${counter}`;
      opts.commentSink?.({ issueId, body, url });
      return { url };
    },
  };
}
