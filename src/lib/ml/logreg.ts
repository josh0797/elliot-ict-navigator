// Pure-JS logistic regression with L2 regularization (full-batch gradient descent).
// Worker-runtime safe: no native deps, no Node-only modules.

export type LogRegModel = {
  weights: number[]; // length = nFeatures
  bias: number;
};

export type TrainOptions = {
  learningRate?: number;
  epochs?: number;
  l2?: number;
};

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function trainLogReg(
  X: number[][],
  y: number[],
  opts: TrainOptions = {},
): LogRegModel {
  const lr = opts.learningRate ?? 0.1;
  const epochs = opts.epochs ?? 400;
  const l2 = opts.l2 ?? 0.01;
  const m = X.length;
  if (m === 0) throw new Error("empty training set");
  const n = X[0].length;
  const w = new Array(n).fill(0);
  let b = 0;
  for (let ep = 0; ep < epochs; ep++) {
    const dw = new Array(n).fill(0);
    let db = 0;
    for (let i = 0; i < m; i++) {
      let z = b;
      const xi = X[i];
      for (let j = 0; j < n; j++) z += w[j] * xi[j];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < n; j++) dw[j] += err * xi[j];
      db += err;
    }
    for (let j = 0; j < n; j++) {
      w[j] -= lr * (dw[j] / m + l2 * w[j]);
    }
    b -= lr * (db / m);
  }
  return { weights: w, bias: b };
}

export function predictProba(model: LogRegModel, x: number[]): number {
  let z = model.bias;
  for (let j = 0; j < x.length; j++) z += model.weights[j] * x[j];
  return sigmoid(z);
}

export type Metrics = {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  trainSize: number;
  valSize: number;
  positives: number;
  negatives: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
};

export function evaluate(model: LogRegModel, X: number[][], y: number[]): Metrics {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (let i = 0; i < X.length; i++) {
    const p = predictProba(model, X[i]);
    const pred = p >= 0.5 ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp++;
    else if (pred === 1 && y[i] === 0) fp++;
    else if (pred === 0 && y[i] === 0) tn++;
    else fn++;
  }
  const total = tp + fp + tn + fn;
  const accuracy = total ? (tp + tn) / total : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    accuracy,
    precision,
    recall,
    f1,
    trainSize: 0,
    valSize: X.length,
    positives: tp + fn,
    negatives: tn + fp,
    confusion: { tp, fp, tn, fn },
  };
}