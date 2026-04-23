export {
  scanRepository,
  loadConfigFromFile,
  detectMarkdownIndexHotspot,
  formatResult,
  hasBlockingFindings,
  DEFAULT_CONFIG,
} from "./scan.js";
export type {
  PolicyConfig,
  PolicyFinding,
  ScanOptions,
  ScanResult,
  Severity,
} from "./scan.js";
