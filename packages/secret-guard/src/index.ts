export {
  scanText,
  scanPaths,
  isForbiddenDotenvFile,
  hasBlockingFindings,
  formatResult,
} from "./scan.js";
export type {
  ScanResult,
  ScanPathsOptions,
  ScanTextOptions,
  SecretFinding,
  Severity,
} from "./scan.js";
