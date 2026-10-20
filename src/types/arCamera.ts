// Shared types for the AR Camera Studio feature:
// camera capture -> AI depth decomposition into texture layers ->
// AR parallax compositing -> MIDI-driven layer effects.

export interface AnalysisParams {
  layerCount: 2 | 3;
  // Depth score split points (0..1). threshold2 is used only when layerCount === 3.
  threshold1: number;
  threshold2: number;
  // AI depth-estimation weights (editable by the user after analysis)
  wLum: number; // luminance contribution (bright = closer)
  wSat: number; // saturation contribution (vivid = closer)
  wPos: number; // vertical position contribution (lower in frame = closer)
  invertDepth: boolean;
  // Mask edge feathering in pixels
  feather: number;
}

export interface LayerStats {
  coverage: number;   // 0..1 fraction of frame pixels in this layer
  meanDepth: number;  // 0..1 average depth score of the layer
  dominantColor: string; // hex of the most common color inside the mask
}

export interface BuiltLayer {
  name: string;
  canvas: HTMLCanvasElement; // masked texture (photo pixels with alpha mask)
  stats: LayerStats;
}

export interface TextureFX {
  visible: boolean;
  opacity: number;      // 0..1
  hue: number;          // degrees 0..360
  saturation: number;   // 0..3, 1 = neutral
  brightness: number;   // 0..3, 1 = neutral
  contrast: number;     // 0..3, 1 = neutral
  blur: number;         // px
  pixelate: number;     // 1 = off, higher = bigger blocks
  posterize: number;    // 0 = off, otherwise color levels (2..12)
  parallaxDepth: number; // per-layer parallax multiplier
}

export const DEFAULT_FX: TextureFX = {
  visible: true,
  opacity: 1,
  hue: 0,
  saturation: 1,
  brightness: 1,
  contrast: 1,
  blur: 0,
  pixelate: 1,
  posterize: 0,
  parallaxDepth: 1,
};

// MIDI mapping: a CC (controller) number bound to a parameter target id.
// Target ids: "L{layerIndex}:{param}" (e.g. "L2:hue") or "G:{param}" (e.g. "G:parallax").
export interface MidiMapping {
  target: string;
  cc: number;
  channel: number; // -1 = any channel
}
