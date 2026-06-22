// legacy-pretrained-html-v1 — frozen forward pass (6→12→8→1, ReLU, sigmoid).
// Dropout is disabled in inference, matching tf.js model.predict() behaviour.

import { PRETRAINED } from "./pretrained";

export const LEGACY_SHAPES = [
  [6, 12],
  [12],
  [12, 8],
  [8],
  [8, 1],
  [1],
] as const;

type Mat = number[][];
type Vec = number[];

function reshape2D(flat: readonly number[], rows: number, cols: number): Mat {
  if (flat.length !== rows * cols) {
    throw new Error(`legacy mlp: bad shape ${rows}x${cols} got ${flat.length}`);
  }
  const out: Mat = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array<number>(cols);
    for (let c = 0; c < cols; c++) row[c] = flat[r * cols + c];
    out[r] = row;
  }
  return out;
}

function asVec(flat: readonly number[], n: number): Vec {
  if (flat.length !== n) throw new Error(`legacy mlp: bad vec ${n} got ${flat.length}`);
  return flat.slice();
}

const W0 = reshape2D(PRETRAINED.weights[0], 6, 12);
const B0 = asVec(PRETRAINED.weights[1], 12);
const W1 = reshape2D(PRETRAINED.weights[2], 12, 8);
const B1 = asVec(PRETRAINED.weights[3], 8);
const W2 = reshape2D(PRETRAINED.weights[4], 8, 1);
const B2 = asVec(PRETRAINED.weights[5], 1);

function relu(x: number): number {
  return x > 0 ? x : 0;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function matVec(W: Mat, b: Vec, x: Vec): Vec {
  const rows = W.length;
  const cols = b.length;
  const out = new Array<number>(cols);
  for (let c = 0; c < cols; c++) {
    let s = b[c];
    for (let r = 0; r < rows; r++) s += W[r][c] * x[r];
    out[c] = s;
  }
  return out;
}

/** Forward pass on a length-6 normalized input. Returns probability in [0,1]. */
export function predictLegacy(xNorm: number[]): number {
  if (xNorm.length !== 6) throw new Error("legacy mlp: input length must be 6");
  const h1raw = matVec(W0, B0, xNorm);
  const h1 = h1raw.map(relu);
  const h2raw = matVec(W1, B1, h1);
  const h2 = h2raw.map(relu);
  const out = matVec(W2, B2, h2);
  return sigmoid(out[0]);
}

export const LEGACY_WEIGHT_MATRICES = { W0, B0, W1, B1, W2, B2 } as const;