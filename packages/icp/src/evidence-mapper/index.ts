/**
 * LAT-182 evidence mapper module.
 *
 * Provides a single entry point for transforming provider outputs into
 * validated, sanitised `RunArtefact` instances with partial-evidence
 * tracking.
 *
 * ```ts
 * import { mapProviderOutput } from "@latentspacelabs/icp/evidence-mapper";
 *
 * const result = mapProviderOutput({
 *   providerOutput: myProviderOutput,
 *   invocation_id: "run-123",
 * });
 *
 * if (result.complete) {
 *   // Use result.artefact
 * } else {
 *   // Handle partial evidence / warnings
 * }
 * ```
 */

export type {
  ProviderOutput,
  PartialEvidence,
  ValidationWarning,
  MapArgs,
  MapResult,
  MappedRunArtefact,
  FailedMap,
} from './contract.js';

export { mapProviderOutput } from './mapper.js';
