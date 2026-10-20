// Client-side AI scene decomposition for the AR Camera Studio.
// Estimates a per-pixel depth score from luminance, saturation and vertical
// position, auto-suggests split thresholds (multi-level Otsu), then slices the
// captured photo into 2-3 feather-masked texture layers (background ->
// midground -> foreground) ready for AR parallax compositing.

import type { AnalysisParams, BuiltLayer, LayerStats } from '../types/arCamera';

export interface FrameFields {
  width: number;
  height: number;
  rgba: Uint8ClampedArray; // downscaled analysis pixels
  lum: Float32Array;       // 0..1
  sat: Float32Array;       // 0..1
}

const ANALYSIS_MAX_WIDTH = 320;
const HIST_BINS = 64;

export const DEFAULT_ANALYSIS_PARAMS: AnalysisParams = {
  layerCount: 3,
  threshold1: 0.35,
  threshold2: 0.65,
  wLum: 0.45,
  wSat: 0.3,
  wPos: 0.25,
  invertDepth: false,
  feather: 6,
};

// Downscale the captured photo and extract per-pixel luminance / saturation.
export function extractFields(photo: HTMLCanvasElement): FrameFields {
  const scale = Math.min(1, ANALYSIS_MAX_WIDTH / photo.width);
  const w = Math.max(2, Math.round(photo.width * scale));
  const h = Math.max(2, Math.round(photo.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;

  const n = w * h;
  const lum = new Float32Array(n);
  const sat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat[i] = max === 0 ? 0 : (max - min) / max;
  }
  return { width: w, height: h, rgba, lum, sat };
}

// Weighted depth score per analysis pixel, normalized to 0..1.
export function computeDepthScore(fields: FrameFields, params: AnalysisParams): Float32Array {
  const { width, height, lum, sat } = fields;
  const wSum = params.wLum + params.wSat + params.wPos || 1;
  const score = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const posTerm = y / (height - 1); // lower rows = closer to the viewer
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let s = (params.wLum * lum[i] + params.wSat * sat[i] + params.wPos * posTerm) / wSum;
      if (params.invertDepth) s = 1 - s;
      score[i] = s;
    }
  }
  return score;
}

// Multi-level Otsu threshold suggestion over the depth-score histogram.
// Returns [t1, t2]; t2 is meaningful only for 3-layer splits.
export function suggestThresholds(score: Float32Array, layerCount: 2 | 3): [number, number] {
  const hist = new Float64Array(HIST_BINS);
  for (let i = 0; i < score.length; i++) {
    const bin = Math.min(HIST_BINS - 1, Math.floor(score[i] * HIST_BINS));
    hist[bin]++;
  }
  const total = score.length;
  // Cumulative weight and mean per bin prefix
  const cumW = new Float64Array(HIST_BINS + 1);
  const cumM = new Float64Array(HIST_BINS + 1);
  for (let b = 0; b < HIST_BINS; b++) {
    cumW[b + 1] = cumW[b] + hist[b];
    cumM[b + 1] = cumM[b] + hist[b] * (b + 0.5);
  }
  const classVar = (lo: number, hi: number) => {
    const w = cumW[hi] - cumW[lo];
    if (w === 0) return { w: 0, m: 0 };
    return { w, m: (cumM[hi] - cumM[lo]) / w };
  };
  const globalMean = cumM[HIST_BINS] / total;

  if (layerCount === 2) {
    let best = 0.5, bestVar = -1;
    for (let t = 1; t < HIST_BINS; t++) {
      const a = classVar(0, t);
      const b = classVar(t, HIST_BINS);
      const v = a.w * (a.m - globalMean) ** 2 + b.w * (b.m - globalMean) ** 2;
      if (v > bestVar) { bestVar = v; best = t / HIST_BINS; }
    }
    return [round2(best), round2(Math.min(0.95, best + 0.25))];
  }

  let bestT1 = 0.33, bestT2 = 0.66, bestVar = -1;
  for (let t1 = 1; t1 < HIST_BINS - 1; t1++) {
    for (let t2 = t1 + 1; t2 < HIST_BINS; t2++) {
      const a = classVar(0, t1);
      const b = classVar(t1, t2);
      const c = classVar(t2, HIST_BINS);
      const v =
        a.w * (a.m - globalMean) ** 2 +
        b.w * (b.m - globalMean) ** 2 +
        c.w * (c.m - globalMean) ** 2;
      if (v > bestVar) { bestVar = v; bestT1 = t1 / HIST_BINS; bestT2 = t2 / HIST_BINS; }
    }
  }
  return [round2(bestT1), round2(bestT2)];
}

const LAYER_NAMES = ['Background', 'Midground', 'Foreground'];

// Slice the photo into masked layer textures using the depth score + thresholds.
export function buildLayerCanvases(
  photo: HTMLCanvasElement,
  fields: FrameFields,
  score: Float32Array,
  params: AnalysisParams
): BuiltLayer[] {
  const ranges: [number, number][] =
    params.layerCount === 2
      ? [[0, params.threshold1], [params.threshold1, 1.001]]
      : [
          [0, params.threshold1],
          [params.threshold1, params.threshold2],
          [params.threshold2, 1.001],
        ];

  const { width: aw, height: ah, rgba } = fields;
  const layers: BuiltLayer[] = [];

  ranges.forEach(([lo, hi], idx) => {
    // Binary alpha mask at analysis resolution
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = aw;
    maskCanvas.height = ah;
    const maskCtx = maskCanvas.getContext('2d')!;
    const maskData = maskCtx.createImageData(aw, ah);

    let count = 0;
    let depthSum = 0;
    const colorHist = new Map<number, number>();

    for (let i = 0; i < score.length; i++) {
      const inRange = score[i] >= lo && score[i] < hi;
      if (inRange) {
        maskData.data[i * 4] = 255;
        maskData.data[i * 4 + 1] = 255;
        maskData.data[i * 4 + 2] = 255;
        maskData.data[i * 4 + 3] = 255;
        count++;
        depthSum += score[i];
        // 4-bit-per-channel color histogram for dominant color
        const key =
          ((rgba[i * 4] >> 4) << 8) | ((rgba[i * 4 + 1] >> 4) << 4) | (rgba[i * 4 + 2] >> 4);
        colorHist.set(key, (colorHist.get(key) || 0) + 1);
      }
    }
    maskCtx.putImageData(maskData, 0, 0);

    // Feathered mask scaled up to photo resolution, then photo composited in
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = photo.width;
    layerCanvas.height = photo.height;
    const ctx = layerCanvas.getContext('2d')!;
    ctx.filter = params.feather > 0 ? `blur(${params.feather}px)` : 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(maskCanvas, 0, 0, photo.width, photo.height);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(photo, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    let dominant = '#808080';
    let bestCount = 0;
    colorHist.forEach((c, key) => {
      if (c > bestCount) {
        bestCount = c;
        const r = ((key >> 8) & 0xf) << 4;
        const g = ((key >> 4) & 0xf) << 4;
        const b = (key & 0xf) << 4;
        dominant = '#' + [r + 8, g + 8, b + 8].map(v => v.toString(16).padStart(2, '0')).join('');
      }
    });

    const stats: LayerStats = {
      coverage: count / score.length,
      meanDepth: count > 0 ? depthSum / count : 0,
      dominantColor: dominant,
    };

    layers.push({
      name: LAYER_NAMES[params.layerCount === 2 && idx === 1 ? 2 : idx],
      canvas: layerCanvas,
      stats,
    });
  });

  return layers;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
