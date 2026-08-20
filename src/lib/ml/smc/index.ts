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
