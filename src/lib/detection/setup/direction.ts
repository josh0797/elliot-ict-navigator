/**
 * Re-export the canonical direction-bias calculation (lives under
 * `decision/direction.ts`) under the `setup/` namespace per Phase-14
 * folder layout.
 */
export { computeDirectionBias } from "../decision/direction";
export type { DirectionVote, DirectionBiasResult, VoteDirection } from "../decision/types";