/**
 * SMC_M30 model family — public surface (feature engine only, no training yet).
 * Live trading behaviour is intentionally untouched by this module.
 */
export { londonClock, londonSession, londonUtcOffsetMinutes, SMC_SESSIONS } from "./clock";
export {
  buildSmcFeatures,
  resolveAtrValue,
  SMC_FEATURE_COUNT,
  SMC_FEATURE_NAMES,
  type SmcFeatureName,
} from "./features";
export { classifySmcRegime } from "./regimes";
export {
  SMC_FEATURE_SCHEMA_VERSION,
  type CandidateDirection,
  type LondonClock,
  type SmcFeatureContext,
  type SmcFeatureResult,
  type SmcModelFamily,
  type SmcRegime,
  type SmcRegimeResult,
  type SmcSession,
} from "./types";
export {
  SMC_OPERATIVE_MASK_NAME,
  SMC_OPERATIVE_MASK_VERSION,
  SMC_OPERATIVE_V1,
  SMC_OPERATIVE_V1_COUNT,
  SMC_OPERATIVE_V1_INDICES,
  operativeV1NamedView,
  projectOperativeV1,
  projectOperativeV1Named,
  type SmcOperativeFeatureName,
} from "./masks";
export {
  buildFeatureWindow,
  buildOutcomeWindow,
  buildSmcDataset,
  buildSmcDatasetRow,
  floorToMinute,
  resampleClosed,
  type OhlcvLoader,
  type SmcAuditContext,
  type SmcDatasetOptions,
  type SmcDatasetResult,
  type SmcDatasetRow,
  type SmcEntry,
  type SmcFeatureSnapshot,
  type SmcNegativeCandidate,
  type SmcOutcomes,
  type SmcProvenance,
} from "./dataset";
export {
  generateNegativeCandidates,
  negativesToEntries,
  type NegativeSamplingOptions,
} from "./negatives";
export {
  comparePositiveVsNegative,
  summarizeByDisplacementOutcome,
  summarizeOperativeFeatures,
  type FeatureStats,
  type GroupComparison,
} from "./summary";
