/**
 * Write-back formatter (ADR-0012 § "Write-back formatter", ADR-0003, ADR-0006).
 *
 * Renders the exact five-element Linear comment string defined by ADR-0006
 * from a run-report envelope. Does not post — that is the Linear adapter's
 * job. Does not decide outcome — that is the skill's job. Open questions are
 * passed through so the dispatch skill can surface them alongside the
 * envelope-derived fields.
 */
import type { RunReport, WriteBackFormatter } from "../runtime/contract.js";

export interface FormatInput {
  report: RunReport;
  run_report_url: string;
  open_questions: ReadonlyArray<string>;
}

export function createWriteBackFormatter(): WriteBackFormatter & {
  formatFull(input: FormatInput): string;
} {
  const formatFull = (input: FormatInput): string => {
    const { report, run_report_url, open_questions } = input;
    const risks: string[] = [];
    if (report.cost.band !== "normal" && report.cost.band !== "unknown") {
      risks.push(`cost_band=${report.cost.band}`);
    }
    if (report.errors.length > 0) risks.push(...report.errors);
    const risksLine = risks.length === 0 ? "none" : risks.join("; ");

    const evidenceParts: string[] = [];
    if (report.correlation.pr_url) evidenceParts.push(report.correlation.pr_url);
    evidenceParts.push(run_report_url);

    const lines: string[] = [];
    lines.push(`**Outcome:** ${report.summary}`);
    lines.push(`**Evidence:** ${evidenceParts.join(" · ")}`);
    lines.push(`**Risks:** ${risksLine}`);
    lines.push(`**PR:** ${report.correlation.pr_url ?? "n/a"}`);
    lines.push(`**Next action:** ${report.next_actions[0] ?? "none"}`);
    lines.push(
      `**Open questions:** ${open_questions.length === 0 ? "none" : open_questions.join("; ")}`,
    );
    return lines.join("\n");
  };

  return {
    format(report: RunReport): string {
      return formatFull({ report, run_report_url: "", open_questions: [] });
    },
    formatFull,
  };
}
