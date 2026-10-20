import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  Camera,
  RefreshCw,
  Eye,
  EyeOff,
  Music,
  Wand2,
  SlidersHorizontal,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';
import type { AnalysisParams, BuiltLayer, TextureFX, MidiMapping } from '../types/arCamera';
import { DEFAULT_FX } from '../types/arCamera';
import {
  DEFAULT_ANALYSIS_PARAMS,
  extractFields,
  computeDepthScore,
  suggestThresholds,
  buildLayerCanvases,
} from '../utils/arSegmentation';
import type { FrameFields } from '../utils/arSegmentation';
import { MidiEngine } from '../utils/midiEngine';

const MIDI_MAP_STORAGE_KEY = 'sveti_ar_midi_map';
const CAPTURE_MAX_WIDTH = 1280;

// Base parallax offset per layer slot (background barely moves, foreground moves most)
const LAYER_PARALLAX_BASE = [0.25, 0.6, 1.0];

type TabId = 'analysis' | 'texture' | 'midi';

// MIDI-learn badge rendered next to mappable sliders
function MidiBadge({ mappedCc, isLearning, onClick }: {
  mappedCc: number | null;
  isLearning: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border transition-all shrink-0 ${
        isLearning
          ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 animate-pulse'
          : mappedCc !== null
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-zinc-800/60 border-white/5 text-zinc-500 hover:text-zinc-300'
      }`}
      title={mappedCc !== null ? `Mapped to CC ${mappedCc}` : 'Click, then move a MIDI knob to map'}
    >
      {isLearning ? 'MOVE KNOB…' : mappedCc !== null ? `CC${mappedCc}` : 'MIDI'}
    </button>
  );
}

// Slider row with an editable numeric readout + optional MIDI badge
function FxSlider({ label, value, min, max, step, badge, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  badge?: ReactNode;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center text-[10px]">
        <span className="text-zinc-400 font-medium flex items-center gap-1.5">
          {label}
          {badge}
        </span>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
          className="w-16 bg-black/60 border border-white/5 rounded px-1.5 py-0.5 text-right text-primary font-mono font-bold text-[10px] focus:outline-none focus:border-primary"
          aria-label={label}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-primary bg-zinc-950 h-1 rounded-lg appearance-none cursor-pointer"
      />
    </div>
  );
}

export function ARCameraStudio() {
  // ---- camera / capture state ----
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);

  // ---- AI analysis state ----
  const fieldsRef = useRef<FrameFields | null>(null);
  const scoreRef = useRef<Float32Array | null>(null);
  const [params, setParams] = useState<AnalysisParams>(DEFAULT_ANALYSIS_PARAMS);
  const [baseLayers, setBaseLayers] = useState<BuiltLayer[]>([]);
  const [fxList, setFxList] = useState<TextureFX[]>([]);
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);

  // ---- AR stage state ----
  const [arLive, setArLive] = useState(true);
  const [parallaxIntensity, setParallaxIntensity] = useState(1);
  const parallaxRef = useRef(1);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const layerWrapRefs = useRef<(HTMLDivElement | null)[]>([]);
  const layerCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const tiltTarget = useRef({ x: 0, y: 0 });
  const tiltCurrent = useRef({ x: 0, y: 0 });
  const fxListRef = useRef<TextureFX[]>([]);
  const [needsMotionPermission, setNeedsMotionPermission] = useState(false);

  // ---- MIDI state ----
  const midiRef = useRef<MidiEngine | null>(null);
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<MidiMapping[]>(() => {
    try {
      const raw = localStorage.getItem(MIDI_MAP_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [learnTarget, setLearnTarget] = useState<string | null>(null);
  const [lastMidiEvent, setLastMidiEvent] = useState<string | null>(null);
  const mappingsRef = useRef<MidiMapping[]>(mappings);
  const learnTargetRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('analysis');

  // ================= CAMERA =================

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    stopStream();
    setCameraError(null);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
    } catch (err: any) {
      setCameraError(err?.message || 'Camera access denied');
    }
  }, [stopStream]);

  // The <video> element remounts when switching capture <-> AR modes,
  // so reattach the live stream whenever it appears.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => stopStream();
  }, [facingMode, startCamera, stopStream]);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const scale = Math.min(1, CAPTURE_MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas);
    runInitialAnalysis(canvas);
  };

  const retake = () => {
    setPhoto(null);
    setBaseLayers([]);
    setFxList([]);
    fieldsRef.current = null;
    scoreRef.current = null;
    setActiveTab('analysis');
    if (!streamRef.current) startCamera(facingMode);
  };

  // ================= AI ANALYSIS =================

  const runInitialAnalysis = (capturedPhoto: HTMLCanvasElement) => {
    setAnalyzing(true);
    // Let the capture UI paint before the heavy pixel work
    requestAnimationFrame(() => {
      const fields = extractFields(capturedPhoto);
      fieldsRef.current = fields;
      const score = computeDepthScore(fields, DEFAULT_ANALYSIS_PARAMS);
      const [t1, t2] = suggestThresholds(score, DEFAULT_ANALYSIS_PARAMS.layerCount);
      scoreRef.current = score;
      setParams({ ...DEFAULT_ANALYSIS_PARAMS, threshold1: t1, threshold2: t2 });
      setSelectedLayer(DEFAULT_ANALYSIS_PARAMS.layerCount - 1);
      setAnalyzing(false);
    });
  };

  const reSuggestThresholds = () => {
    if (!scoreRef.current) return;
    const [t1, t2] = suggestThresholds(scoreRef.current, params.layerCount);
    setParams(p => ({ ...p, threshold1: t1, threshold2: t2 }));
  };

  // Rebuild layer textures whenever the photo or analysis numbers change (debounced)
  useEffect(() => {
    if (!photo || !fieldsRef.current) return;
    const timer = setTimeout(() => {
      const fields = fieldsRef.current!;
      const score = computeDepthScore(fields, params);
      scoreRef.current = score;
      const built = buildLayerCanvases(photo, fields, score, params);
      setBaseLayers(built);
      setFxList(prev => built.map((_, i) => prev[i] ? prev[i] : { ...DEFAULT_FX }));
      setSelectedLayer(s => Math.min(s, built.length - 1));
    }, 120);
    return () => clearTimeout(timer);
  }, [photo, params]);

  // ================= TEXTURE FX RENDERING =================

  const renderLayerDisplay = useCallback((base: BuiltLayer, fx: TextureFX, dest: HTMLCanvasElement) => {
    dest.width = base.canvas.width;
    dest.height = base.canvas.height;
    const ctx = dest.getContext('2d')!;
    ctx.clearRect(0, 0, dest.width, dest.height);

    let source: HTMLCanvasElement = base.canvas;
    if (fx.pixelate > 1) {
      const pw = Math.max(2, Math.round(dest.width / fx.pixelate));
      const ph = Math.max(2, Math.round(dest.height / fx.pixelate));
      const small = document.createElement('canvas');
      small.width = pw;
      small.height = ph;
      small.getContext('2d')!.drawImage(base.canvas, 0, 0, pw, ph);
      source = small;
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.imageSmoothingEnabled = true;
    }

    ctx.filter = [
      fx.hue !== 0 ? `hue-rotate(${fx.hue}deg)` : '',
      fx.saturation !== 1 ? `saturate(${fx.saturation})` : '',
      fx.brightness !== 1 ? `brightness(${fx.brightness})` : '',
      fx.contrast !== 1 ? `contrast(${fx.contrast})` : '',
      fx.blur > 0 ? `blur(${fx.blur}px)` : '',
    ].filter(Boolean).join(' ') || 'none';
    ctx.drawImage(source, 0, 0, dest.width, dest.height);
    ctx.filter = 'none';

    if (fx.posterize >= 2) {
      const img = ctx.getImageData(0, 0, dest.width, dest.height);
      const levels = Math.round(fx.posterize);
      const step = 255 / (levels - 1);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        d[i] = Math.round(d[i] / step) * step;
        d[i + 1] = Math.round(d[i + 1] / step) * step;
        d[i + 2] = Math.round(d[i + 2] / step) * step;
      }
      ctx.putImageData(img, 0, 0);
    }
  }, []);

  useEffect(() => {
    baseLayers.forEach((base, i) => {
      const dest = layerCanvasRefs.current[i];
      const fx = fxList[i];
      if (dest && fx) renderLayerDisplay(base, fx, dest);
    });
  }, [baseLayers, fxList, renderLayerDisplay]);

  const updateFx = useCallback((layerIdx: number, patch: Partial<TextureFX>) => {
    setFxList(prev => prev.map((fx, i) => (i === layerIdx ? { ...fx, ...patch } : fx)));
  }, []);

  // ================= AR PARALLAX =================

  const orientationHandler = useRef<((e: DeviceOrientationEvent) => void) | null>(null);

  const attachOrientation = useCallback(() => {
    const handler = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      tiltTarget.current.x = Math.max(-1, Math.min(1, e.gamma / 30));
      tiltTarget.current.y = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
    };
    orientationHandler.current = handler;
    window.addEventListener('deviceorientation', handler);
  }, []);

  useEffect(() => {
    const isIOS = typeof (DeviceOrientationEvent as any)?.requestPermission === 'function';
    setNeedsMotionPermission(isIOS);
    if (!isIOS) attachOrientation();
    return () => {
      if (orientationHandler.current) {
        window.removeEventListener('deviceorientation', orientationHandler.current);
        orientationHandler.current = null;
      }
    };
  }, [attachOrientation]);

  const requestMotionAccess = async () => {
    try {
      const result = await (DeviceOrientationEvent as any).requestPermission();
      if (result === 'granted') {
        attachOrientation();
        setNeedsMotionPermission(false);
      }
    } catch {
      // user dismissed; pointer parallax still works
    }
  };

  const handleStagePointer = (e: React.PointerEvent) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    tiltTarget.current.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    tiltTarget.current.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  };

  // Smooth parallax animation loop (CSS transforms only, no canvas redraw)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const cur = tiltCurrent.current;
      const tgt = tiltTarget.current;
      cur.x += (tgt.x - cur.x) * 0.08;
      cur.y += (tgt.y - cur.y) * 0.08;
      const fxs = fxListRef.current;
      layerWrapRefs.current.forEach((el, i) => {
        if (!el) return;
        const slotBase = LAYER_PARALLAX_BASE[Math.min(i, LAYER_PARALLAX_BASE.length - 1)];
        const depth = slotBase * (fxs[i]?.parallaxDepth ?? 1) * parallaxRef.current;
        const tx = -cur.x * 26 * depth;
        const ty = -cur.y * 18 * depth;
        const scale = 1 + depth * 0.06;
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ================= MIDI =================

  // Apply a normalized 0..1 CC value onto a mapped parameter target
  const applyMidiValue = useCallback((target: string, v: number) => {
    if (target === 'G:parallax') { setParallaxIntensity(Math.round(v * 200) / 100); return; }
    if (target === 'G:threshold1') { setParams(p => ({ ...p, threshold1: Math.round(v * 100) / 100 })); return; }
    if (target === 'G:threshold2') { setParams(p => ({ ...p, threshold2: Math.round(v * 100) / 100 })); return; }
    if (target === 'G:feather') { setParams(p => ({ ...p, feather: Math.round(v * 20) })); return; }
    const match = target.match(/^L(\d+):(\w+)$/);
    if (!match) return;
    const idx = Number(match[1]);
    const param = match[2];
    const patch: Partial<TextureFX> = {};
    switch (param) {
      case 'opacity': patch.opacity = Math.round(v * 100) / 100; break;
      case 'hue': patch.hue = Math.round(v * 360); break;
      case 'saturation': patch.saturation = Math.round(v * 30) / 10; break;
      case 'brightness': patch.brightness = Math.round(v * 30) / 10; break;
      case 'contrast': patch.contrast = Math.round(v * 30) / 10; break;
      case 'blur': patch.blur = Math.round(v * 12); break;
      case 'pixelate': patch.pixelate = Math.round(1 + v * 30); break;
      case 'posterize': patch.posterize = v < 0.05 ? 0 : Math.round(2 + v * 10); break;
      case 'depth': patch.parallaxDepth = Math.round(v * 20) / 10; break;
      default: return;
    }
    updateFx(idx, patch);
  }, [updateFx]);

  const applyMidiValueRef = useRef(applyMidiValue);

  // Keep "latest value" refs in sync for callbacks that live outside React
  // (the MIDI message handler and the rAF parallax loop)
  useEffect(() => {
    parallaxRef.current = parallaxIntensity;
    fxListRef.current = fxList;
    mappingsRef.current = mappings;
    learnTargetRef.current = learnTarget;
    applyMidiValueRef.current = applyMidiValue;
  });

  const enableMidi = async () => {
    setMidiError(null);
    try {
      const engine = new MidiEngine();
      const inputs = await engine.init();
      engine.onDevicesChanged = names => setMidiInputs(names);
      engine.onMessage(msg => {
        if (msg.type === 'cc') {
          setLastMidiEvent(`CC ${msg.controller} = ${Math.round(msg.value * 127)} (ch ${msg.channel + 1})`);
          const learning = learnTargetRef.current;
          if (learning) {
            setMappings(prev => {
              const next = [
                ...prev.filter(m => m.target !== learning && !(m.cc === msg.controller && m.channel === msg.channel)),
                { target: learning, cc: msg.controller, channel: msg.channel },
              ];
              localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify(next));
              return next;
            });
            setLearnTarget(null);
            return;
          }
          mappingsRef.current.forEach(m => {
            if (m.cc === msg.controller && (m.channel === -1 || m.channel === msg.channel)) {
              applyMidiValueRef.current(m.target, msg.value);
            }
          });
        } else if (msg.type === 'noteon') {
          setLastMidiEvent(`Note ${msg.note} on (ch ${msg.channel + 1})`);
          // Notes 60 / 61 / 62 (middle C up) toggle layer visibility live
          const layerIdx = msg.note - 60;
          if (layerIdx >= 0 && layerIdx < fxListRef.current.length) {
            setFxList(prev => prev.map((fx, i) => (i === layerIdx ? { ...fx, visible: !fx.visible } : fx)));
          }
        }
      });
      midiRef.current = engine;
      setMidiInputs(inputs);
      setMidiEnabled(true);
    } catch (err: any) {
      setMidiError(err?.message || 'Failed to access MIDI');
    }
  };

  useEffect(() => () => { midiRef.current?.destroy(); }, []);

  const removeMapping = (target: string) => {
    setMappings(prev => {
      const next = prev.filter(m => m.target !== target);
      localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const midiBadge = (target: string) => {
    const mapped = mappings.find(m => m.target === target);
    return (
      <MidiBadge
        mappedCc={mapped ? mapped.cc : null}
        isLearning={learnTarget === target}
        onClick={() => {
          if (!midiEnabled) { setActiveTab('midi'); return; }
          setLearnTarget(prev => (prev === target ? null : target));
        }}
      />
    );
  };

  const selFx = fxList[selectedLayer];
  const stageAspect = photo ? photo.width / photo.height : 16 / 9;

  // ================= RENDER =================

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* ---------- CAPTURE MODE ---------- */}
      {!photo && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
              <Camera size={16} className="text-primary" />
              AR Camera
            </h2>
            <span className="text-[9px] bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded text-primary font-mono font-bold uppercase">
              AI Depth Scanner
            </span>
          </div>

          <div className="relative rounded-2xl overflow-hidden bg-black border border-white/5 shadow-inner" style={{ aspectRatio: '4 / 3' }}>
            <video
              ref={attachVideo}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-xs font-mono animate-pulse">
                // initializing camera…
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <span className="text-red-400 text-xs font-semibold">⚠️ {cameraError}</span>
                <button
                  onClick={() => startCamera(facingMode)}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[10px] font-bold hover:bg-red-500/20 transition-all"
                >
                  Retry Access
                </button>
              </div>
            )}
            {/* Scanner frame decoration */}
            <div className="absolute inset-3 border border-purple-500/20 rounded-xl pointer-events-none">
              <div className="absolute -top-px -left-px w-5 h-5 border-t-2 border-l-2 border-primary rounded-tl-lg" />
              <div className="absolute -top-px -right-px w-5 h-5 border-t-2 border-r-2 border-primary rounded-tr-lg" />
              <div className="absolute -bottom-px -left-px w-5 h-5 border-b-2 border-l-2 border-primary rounded-bl-lg" />
              <div className="absolute -bottom-px -right-px w-5 h-5 border-b-2 border-r-2 border-primary rounded-br-lg" />
            </div>
          </div>

          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setFacingMode(m => (m === 'environment' ? 'user' : 'environment'))}
              className="w-11 h-11 rounded-full bg-zinc-900/80 border border-white/10 text-zinc-300 flex items-center justify-center hover:text-white transition-all"
              title="Flip camera"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={capturePhoto}
              disabled={!cameraReady}
              className="w-16 h-16 rounded-full neon-btn-pink-purple flex items-center justify-center disabled:opacity-30 shadow-[0_0_25px_var(--primary-glow)] transition-all active:scale-95"
              title="Capture & analyze"
            >
              <Camera size={24} className="text-white" />
            </button>
            <div className="w-11 h-11" />
          </div>
          <p className="text-[10px] text-zinc-500 text-center font-mono">
            // capture a scene — AI will decompose it into AR depth layers
          </p>
        </div>
      )}

      {/* ---------- AR STUDIO MODE ---------- */}
      {photo && (
        <>
          {/* AR Stage */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                <Sparkles size={15} className="text-primary" />
                AR Stage
              </h2>
              <div className="flex items-center gap-2">
                {needsMotionPermission && (
                  <button
                    onClick={requestMotionAccess}
                    className="px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[9px] font-bold"
                  >
                    Enable Motion
                  </button>
                )}
                <button
                  onClick={() => setArLive(v => !v)}
                  className={`px-2 py-1 rounded-lg text-[9px] font-bold border transition-all ${
                    arLive
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-zinc-800/60 border-white/5 text-zinc-400'
                  }`}
                >
                  {arLive ? '● AR LIVE' : '○ AR OFF'}
                </button>
                <button
                  onClick={retake}
                  className="px-2 py-1 rounded-lg bg-zinc-800/60 border border-white/5 text-zinc-300 text-[9px] font-bold hover:text-white transition-all flex items-center gap-1"
                >
                  <Camera size={10} /> Retake
                </button>
              </div>
            </div>

            <div
              ref={stageRef}
              onPointerMove={handleStagePointer}
              className="relative rounded-2xl overflow-hidden bg-black border border-white/5 touch-none select-none"
              style={{ aspectRatio: `${stageAspect}`, perspective: '900px' }}
            >
              {/* Live camera passthrough = the "AR" backdrop */}
              <video
                ref={attachVideo}
                autoPlay
                playsInline
                muted
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${arLive ? 'opacity-100' : 'opacity-0'}`}
              />
              {!arLive && (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(139,92,246,0.12)_0%,#020204_70%)]" />
              )}

              {/* Depth layers with parallax */}
              {baseLayers.map((layer, i) => (
                <div
                  key={layer.name + i}
                  ref={el => { layerWrapRefs.current[i] = el; }}
                  className="absolute inset-0 will-change-transform"
                  style={{
                    opacity: fxList[i]?.visible ? fxList[i].opacity : 0,
                    transition: 'opacity 0.25s ease',
                  }}
                >
                  <canvas
                    ref={el => { layerCanvasRefs.current[i] = el; }}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}

              {analyzing && (
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-10">
                  <Wand2 size={22} className="text-primary animate-pulse" />
                  <span className="text-[10px] text-zinc-300 font-mono animate-pulse">// AI depth analysis running…</span>
                </div>
              )}
            </div>

            {/* Global parallax intensity */}
            <FxSlider
              label="Parallax Intensity"
              value={Math.round(parallaxIntensity * 100) / 100}
              min={0}
              max={2}
              step={0.05}
              badge={midiBadge('G:parallax')}
              onChange={setParallaxIntensity}
            />
          </div>

          {/* Tab switcher */}
          <div className="flex bg-black/40 border border-white/5 rounded-xl p-1 gap-1">
            {([
              { id: 'analysis' as TabId, icon: <Wand2 size={12} />, label: 'AI Analysis' },
              { id: 'texture' as TabId, icon: <SlidersHorizontal size={12} />, label: 'Textures' },
              { id: 'midi' as TabId, icon: <Music size={12} />, label: 'MIDI' },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                  activeTab === tab.id
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* ---------- TAB: AI ANALYSIS NUMBERS ---------- */}
          {activeTab === 'analysis' && (
            <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col gap-4 animate-fade-in">
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Wand2 size={13} className="text-primary" /> AI Depth Decomposition
                </h3>
                <button
                  onClick={reSuggestThresholds}
                  className="px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[9px] font-bold hover:bg-primary/25 transition-all"
                >
                  ✨ Re-run AI Suggest
                </button>
              </div>

              {/* Layer count */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400 font-medium">Decomposition Layers</span>
                <div className="flex bg-black/40 border border-white/5 rounded-lg p-0.5">
                  {([2, 3] as const).map(n => (
                    <button
                      key={n}
                      onClick={() => setParams(p => ({ ...p, layerCount: n }))}
                      className={`px-3 py-1 rounded text-[10px] font-bold transition-all ${
                        params.layerCount === n ? 'bg-primary text-white' : 'text-zinc-400'
                      }`}
                    >
                      {n} Layers
                    </button>
                  ))}
                </div>
              </div>

              {/* Editable analyzed numbers */}
              <FxSlider
                label="Depth Split 1 (bg / mid)"
                value={params.threshold1} min={0.02} max={0.98} step={0.01}
                badge={midiBadge('G:threshold1')}
                onChange={v => setParams(p => ({
                  ...p,
                  threshold1: p.layerCount === 3 ? Math.min(v, p.threshold2 - 0.02) : v,
                }))}
              />
              {params.layerCount === 3 && (
                <FxSlider
                  label="Depth Split 2 (mid / fg)"
                  value={params.threshold2} min={0.04} max={0.99} step={0.01}
                  badge={midiBadge('G:threshold2')}
                  onChange={v => setParams(p => ({ ...p, threshold2: Math.max(v, p.threshold1 + 0.02) }))}
                />
              )}

              <div className="grid grid-cols-3 gap-3 border-t border-white/5 pt-3">
                <FxSlider
                  label="W: Light" value={params.wLum} min={0} max={1} step={0.05}
                  onChange={v => setParams(p => ({ ...p, wLum: v }))}
                />
                <FxSlider
                  label="W: Color" value={params.wSat} min={0} max={1} step={0.05}
                  onChange={v => setParams(p => ({ ...p, wSat: v }))}
                />
                <FxSlider
                  label="W: Position" value={params.wPos} min={0} max={1} step={0.05}
                  onChange={v => setParams(p => ({ ...p, wPos: v }))}
                />
              </div>

              <FxSlider
                label="Mask Feather (px)"
                value={params.feather} min={0} max={20} step={1}
                badge={midiBadge('G:feather')}
                onChange={v => setParams(p => ({ ...p, feather: v }))}
              />

              <button
                onClick={() => setParams(p => ({ ...p, invertDepth: !p.invertDepth }))}
                className={`w-full py-2 rounded-xl text-[10px] font-bold border transition-all ${
                  params.invertDepth
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                    : 'bg-black/40 border-white/5 text-zinc-400'
                }`}
              >
                {params.invertDepth ? '↕ Depth Inverted' : '↕ Invert Depth Direction'}
              </button>

              {/* Per-layer AI stats */}
              <div className="flex flex-col gap-2 border-t border-white/5 pt-3">
                <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Analyzed Layer Stats</span>
                {baseLayers.map((layer, i) => (
                  <div key={i} className="flex items-center justify-between bg-black/40 border border-white/5 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-4 h-4 rounded-full border border-white/20 shrink-0"
                        style={{ backgroundColor: layer.stats.dominantColor }}
                        title={`Dominant: ${layer.stats.dominantColor}`}
                      />
                      <span className="text-[11px] font-bold text-white">{layer.name}</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[9px]">
                      <span className="text-zinc-400">cover <span className="text-primary font-bold">{(layer.stats.coverage * 100).toFixed(1)}%</span></span>
                      <span className="text-zinc-400">depth <span className="text-secondary font-bold">{layer.stats.meanDepth.toFixed(2)}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---------- TAB: TEXTURE MODIFICATION ---------- */}
          {activeTab === 'texture' && (
            <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col gap-4 animate-fade-in">
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Layers size={13} className="text-primary" /> Layer Texture FX
                </h3>
              </div>

              {/* Layer selector chips */}
              <div className="flex gap-2">
                {baseLayers.map((layer, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedLayer(i)}
                    className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-1.5 ${
                      selectedLayer === i
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'bg-black/40 border-white/5 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: layer.stats.dominantColor }}
                    />
                    {layer.name}
                  </button>
                ))}
              </div>

              {selFx && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400 font-medium">Layer Visibility</span>
                    <button
                      onClick={() => updateFx(selectedLayer, { visible: !selFx.visible })}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 transition-all ${
                        selFx.visible
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-zinc-800/60 border-white/5 text-zinc-500'
                      }`}
                    >
                      {selFx.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                      {selFx.visible ? 'Visible' : 'Hidden'}
                    </button>
                  </div>

                  <FxSlider
                    label="Opacity" value={selFx.opacity} min={0} max={1} step={0.01}
                    badge={midiBadge(`L${selectedLayer}:opacity`)}
                    onChange={v => updateFx(selectedLayer, { opacity: v })}
                  />
                  <FxSlider
                    label="Hue Shift" value={selFx.hue} min={0} max={360} step={1}
                    badge={midiBadge(`L${selectedLayer}:hue`)}
                    onChange={v => updateFx(selectedLayer, { hue: v })}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <FxSlider
                      label="Saturate" value={selFx.saturation} min={0} max={3} step={0.1}
                      badge={midiBadge(`L${selectedLayer}:saturation`)}
                      onChange={v => updateFx(selectedLayer, { saturation: v })}
                    />
                    <FxSlider
                      label="Bright" value={selFx.brightness} min={0} max={3} step={0.1}
                      badge={midiBadge(`L${selectedLayer}:brightness`)}
                      onChange={v => updateFx(selectedLayer, { brightness: v })}
                    />
                    <FxSlider
                      label="Contrast" value={selFx.contrast} min={0} max={3} step={0.1}
                      badge={midiBadge(`L${selectedLayer}:contrast`)}
                      onChange={v => updateFx(selectedLayer, { contrast: v })}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FxSlider
                      label="Blur" value={selFx.blur} min={0} max={12} step={0.5}
                      badge={midiBadge(`L${selectedLayer}:blur`)}
                      onChange={v => updateFx(selectedLayer, { blur: v })}
                    />
                    <FxSlider
                      label="Pixelate" value={selFx.pixelate} min={1} max={32} step={1}
                      badge={midiBadge(`L${selectedLayer}:pixelate`)}
                      onChange={v => updateFx(selectedLayer, { pixelate: v })}
                    />
                    <FxSlider
                      label="Posterize" value={selFx.posterize} min={0} max={12} step={1}
                      badge={midiBadge(`L${selectedLayer}:posterize`)}
                      onChange={v => updateFx(selectedLayer, { posterize: v < 2 ? 0 : v })}
                    />
                  </div>
                  <FxSlider
                    label="Parallax Depth" value={selFx.parallaxDepth} min={0} max={2} step={0.05}
                    badge={midiBadge(`L${selectedLayer}:depth`)}
                    onChange={v => updateFx(selectedLayer, { parallaxDepth: v })}
                  />

                  <button
                    onClick={() => updateFx(selectedLayer, { ...DEFAULT_FX })}
                    className="w-full py-2 rounded-xl bg-black/40 border border-white/5 text-zinc-400 hover:text-white text-[10px] font-bold transition-all"
                  >
                    Reset Layer Texture
                  </button>
                </>
              )}
            </div>
          )}

          {/* ---------- TAB: MIDI CONTROL ---------- */}
          {activeTab === 'midi' && (
            <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col gap-4 animate-fade-in">
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Music size={13} className="text-primary" /> MIDI Performance Control
                </h3>
                {midiEnabled && (
                  <span className="text-[9px] text-emerald-400 font-mono font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" /> ACTIVE
                  </span>
                )}
              </div>

              {!midiEnabled ? (
                <div className="flex flex-col gap-3 items-center py-4">
                  <p className="text-[10px] text-zinc-500 text-center leading-relaxed max-w-[260px]">
                    Connect a MIDI controller and map its knobs to layer effects — hue, opacity, blur,
                    parallax depth and more — for live audiovisual performance.
                  </p>
                  {midiError && (
                    <span className="text-red-400 text-[10px] font-semibold">⚠️ {midiError}</span>
                  )}
                  <button
                    onClick={enableMidi}
                    className="px-5 py-2.5 neon-btn-pink-purple rounded-xl text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-2"
                  >
                    <Music size={13} /> Enable MIDI Input
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Connected Inputs</span>
                    {midiInputs.length === 0 ? (
                      <p className="text-[10px] text-zinc-500 italic">No MIDI devices detected — plug one in, it will appear automatically.</p>
                    ) : (
                      midiInputs.map((name, i) => (
                        <div key={i} className="bg-black/40 border border-white/5 rounded-lg px-3 py-1.5 text-[10px] text-white font-mono flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> {name}
                        </div>
                      ))
                    )}
                  </div>

                  {lastMidiEvent && (
                    <div className="bg-primary/5 border border-primary/15 rounded-lg px-3 py-1.5 text-[10px] font-mono text-primary">
                      ⚡ {lastMidiEvent}
                    </div>
                  )}

                  <div className="bg-black/35 p-3 rounded-xl border border-white/5 text-[9px] text-zinc-500 leading-relaxed">
                    <b className="text-zinc-300">How to map:</b> tap the <span className="text-zinc-300 font-mono">MIDI</span> badge
                    next to any slider (Textures / Analysis tabs), then move a knob or fader on your controller.
                    <br />
                    <b className="text-zinc-300">Notes 60–62</b> (C4, C#4, D4) toggle layer visibility live.
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Active Mappings</span>
                    {mappings.length === 0 ? (
                      <p className="text-[10px] text-zinc-500 italic">No CC mappings yet.</p>
                    ) : (
                      mappings.map(m => (
                        <div key={m.target} className="flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-3 py-1.5">
                          <span className="text-[10px] font-mono text-white">
                            CC{m.cc} <span className="text-zinc-500">→</span> <span className="text-primary">{m.target}</span>
                          </span>
                          <button
                            onClick={() => removeMapping(m.target)}
                            className="text-zinc-500 hover:text-red-400 transition-colors p-0.5"
                            title="Remove mapping"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
