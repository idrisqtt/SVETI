import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bluetooth, Check, ChevronDown, Clock3, Lightbulb, Pause, Play, Plus, Power, Radio, Save, Settings2, Sparkles, Trash2, Unplug, Wand2 } from 'lucide-react';
import { MockBleDevice, WebBleDevice } from './utils/ble/bleDevice';
import type { BleDevice } from './utils/ble/bleDevice';
import { identifyProtocol } from './utils/ble/protocols';
import type { LedProtocol } from './utils/ble/protocols';

type LampKind = 'single' | 'multi';
type DeviceShape = 'bulb' | 'strip' | 'matrix' | 'ring';
type ModeId = 'static' | 'breathe' | 'pulse' | 'flicker' | 'strobe' | 'sequence' | 'gradient' | 'chase' | 'music';
type Scene = { id: string; name: string; description: string; colors: string[]; mode: ModeId; effect: string; kinds: LampKind[] };
type CustomScene = { id: string; name: string; kind: LampKind; mode: ModeId; colors: string[]; brightness: number; speed: number; frequency: number; pulseWidth: number; transition: number; sequencePlayback: 'loop' | 'once' };

const scenes: Scene[] = [
  { id: 'warm', name: 'Тёплый свет', description: 'Спокойный постоянный свет', colors: ['#ffd7a0'], mode: 'static', effect: '1', kinds: ['single', 'multi'] },
  { id: 'breathe', name: 'Дыхание', description: 'Мягко набирает яркость', colors: ['#ff8e6b'], mode: 'breathe', effect: '37', kinds: ['single', 'multi'] },
  { id: 'candle', name: 'Свеча', description: 'Живое тёплое мерцание', colors: ['#ff9d3d'], mode: 'flicker', effect: '1', kinds: ['single'] },
  { id: 'night', name: 'Ночник', description: 'Тусклый фиолетовый свет', colors: ['#7155e8'], mode: 'static', effect: '1', kinds: ['single', 'multi'] },
  { id: 'aurora', name: 'Аврора', description: 'Перелив нескольких цветов', colors: ['#5df2c2', '#5b8cff', '#ad6cff'], mode: 'gradient', effect: '38', kinds: ['multi'] },
  { id: 'party', name: 'Вечеринка', description: 'Динамичный бегущий цвет', colors: ['#ff3d81', '#8d5cff', '#28d7ff', '#54efaa'], mode: 'chase', effect: '41', kinds: ['multi'] },
];

const modes: { id: ModeId; label: string; kinds: LampKind[] }[] = [
  { id: 'static', label: 'Постоянный', kinds: ['single', 'multi'] },
  { id: 'breathe', label: 'Дыхание', kinds: ['single', 'multi'] },
  { id: 'pulse', label: 'Импульс', kinds: ['single', 'multi'] },
  { id: 'flicker', label: 'Свеча', kinds: ['single'] },
  { id: 'strobe', label: 'Мигание', kinds: ['single', 'multi'] },
  { id: 'sequence', label: 'Цикл цветов', kinds: ['single', 'multi'] },
  { id: 'gradient', label: 'Градиент', kinds: ['multi'] },
  { id: 'chase', label: 'Бегущий', kinds: ['multi'] },
  { id: 'music', label: 'Музыка', kinds: ['multi'] },
];

const hexToRgb = (hex: string) => [0, 2, 4].map(i => parseInt(hex.replace('#', '').slice(i, i + 2), 16)) as [number, number, number];
const inferProfile = (device: BleDevice): { kind: LampKind; shape: DeviceShape; count: number; reason: string } => {
  const fingerprint = `${device.name} ${(device.serviceUuids ?? []).join(' ')}`.toLowerCase();
  const isMulti = /(strip|matrix|panel|ring|neon|pixel|sp10|ws28|sk68|ffe0)/.test(fingerprint);
  return isMulti
    ? { kind: 'multi', shape: fingerprint.includes('matrix') || fingerprint.includes('panel') ? 'matrix' : fingerprint.includes('ring') ? 'ring' : 'strip', count: fingerprint.includes('ring') ? 24 : 60, reason: 'По имени и BLE-профилю' }
    : { kind: 'single', shape: 'bulb', count: 1, reason: 'По BLE-профилю' };
};

export default function App() {
  const [device, setDevice] = useState<BleDevice | null>(null);
  const [protocol, setProtocol] = useState<LedProtocol | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [power, setPower] = useState(true);
  const [brightness, setBrightness] = useState(72);
  const [color, setColor] = useState('#ffd7a0');
  const [secondColor, setSecondColor] = useState('#8d5cff');
  const [sequenceColors, setSequenceColors] = useState(['#ff7a45', '#ffd36a', '#54efaa']);
  const [sequencePlayback, setSequencePlayback] = useState<'loop' | 'once'>('loop');
  const [sequenceSeconds, setSequenceSeconds] = useState(2);
  const [activeScene, setActiveScene] = useState('warm');
  const [mode, setMode] = useState<ModeId>('static');
  const [playing, setPlaying] = useState(true);
  const [kind, setKind] = useState<LampKind>('single');
  const [shape, setShape] = useState<DeviceShape>('bulb');
  const [ledCount, setLedCount] = useState(1);
  const [profileSource, setProfileSource] = useState<'auto' | 'manual'>('manual');
  const [profileReason, setProfileReason] = useState('Не подключено');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [frequency, setFrequency] = useState(1.2);
  const [pulseWidth, setPulseWidth] = useState(50);
  const [transition, setTransition] = useState(600);
  const [speed, setSpeed] = useState(45);
  const [timerMinutes, setTimerMinutes] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [notice, setNotice] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [customScenes, setCustomScenes] = useState<CustomScene[]>(() => {
    try { return JSON.parse(localStorage.getItem('sveti_custom_scenes') ?? '[]') as CustomScene[] } catch { return [] }
  });
  const timerRef = useRef<number | null>(null);

  const availableScenes = useMemo(() => scenes.filter(scene => scene.kinds.includes(kind)), [kind]);
  const availableModes = useMemo(() => modes.filter(item => item.kinds.includes(kind)), [kind]);
  const scene = scenes.find(item => item.id === activeScene);
  const palette = mode === 'sequence' ? sequenceColors : scene && activeScene !== 'custom' ? scene.colors : kind === 'multi' && ['gradient', 'chase'].includes(mode) ? [color, secondColor] : [color];
  const previewCount = kind === 'single' ? 1 : shape === 'matrix' ? 64 : shape === 'ring' ? 24 : 34;

  useEffect(() => { if (!notice) return; const id = window.setTimeout(() => setNotice(''), 2600); return () => clearTimeout(id) }, [notice]);
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current) }, []);
  useEffect(() => { localStorage.setItem('sveti_custom_scenes', JSON.stringify(customScenes)) }, [customScenes]);

  // A safe software color sequencer works with both single bulbs and multi-LED
  // controllers because it relies only on the common setRGB command.
  useEffect(() => {
    if (!protocol || !power || !playing || mode !== 'sequence' || sequenceColors.length < 2) return;
    let cancelled = false;
    let writing = false;
    let completed = false;
    const started = performance.now();
    const frame = async () => {
      if (cancelled || writing || completed) return;
      const elapsed = (performance.now() - started) / 1000;
      const rawStep = elapsed / sequenceSeconds;
      const index = Math.floor(rawStep);
      if (sequencePlayback === 'once' && index >= sequenceColors.length - 1) {
        const [r, g, b] = hexToRgb(sequenceColors[sequenceColors.length - 1]);
        completed = true; await protocol.setRGB(r, g, b); setPlaying(false); return;
      }
      const fromIndex = index % sequenceColors.length;
      const toIndex = (fromIndex + 1) % sequenceColors.length;
      const mix = Math.min(1, (rawStep % 1) * sequenceSeconds * 1000 / Math.max(100, transition));
      const from = hexToRgb(sequenceColors[fromIndex]); const to = hexToRgb(sequenceColors[toIndex]);
      const scale = brightness / 100;
      writing = true;
      try { await protocol.setRGB(...from.map((value, channel) => Math.round((value + (to[channel] - value) * mix) * scale)) as [number, number, number]) }
      finally { writing = false }
    };
    void frame(); const interval = window.setInterval(() => void frame(), 120);
    return () => { cancelled = true; clearInterval(interval) };
  }, [protocol, power, playing, mode, sequenceColors, sequencePlayback, sequenceSeconds, transition, brightness]);

  // Single-color bulbs often do not understand controller-specific effect packets.
  // Animate them with universally supported RGB writes instead, without ever sending
  // turnOff between frames. The write lock in WebBleDevice also coalesces slow GATT writes.
  useEffect(() => {
    if (!protocol || kind !== 'single' || !power || mode === 'sequence') return;
    let cancelled = false;
    let writing = false;
    const [baseR, baseG, baseB] = hexToRgb(color);
    const writeLevel = async (level: number) => {
      if (writing || cancelled) return;
      writing = true;
      const scale = Math.max(.025, Math.min(1, level)) * brightness / 100;
      try { await protocol.setRGB(Math.round(baseR * scale), Math.round(baseG * scale), Math.round(baseB * scale)) }
      finally { writing = false }
    };
    if (!playing || mode === 'static') { void writeLevel(1); return () => { cancelled = true } }
    const started = performance.now();
    const frame = () => {
      const elapsed = (performance.now() - started) / 1000;
      const phase = (elapsed * frequency) % 1;
      let level = 1;
      if (mode === 'breathe') level = .16 + .84 * (.5 - .5 * Math.cos(phase * Math.PI * 2));
      if (mode === 'pulse') {
        const width = Math.max(.1, pulseWidth / 100);
        level = phase < width ? .12 + .88 * Math.sin(Math.PI * phase / width) : .12;
      }
      if (mode === 'flicker') level = .48 + .34 * Math.abs(Math.sin(elapsed * 7.1)) + .18 * Math.abs(Math.sin(elapsed * 13.7 + 1.4));
      if (mode === 'strobe') level = phase < pulseWidth / 100 ? 1 : .035;
      void writeLevel(level);
    };
    frame();
    const interval = window.setInterval(frame, 90);
    return () => { cancelled = true; window.clearInterval(interval) };
  }, [protocol, kind, power, playing, mode, color, brightness, frequency, pulseWidth]);

  const setProfile = (nextKind: LampKind, nextShape?: DeviceShape, nextCount?: number, manual = true) => {
    setKind(nextKind); setShape(nextShape ?? (nextKind === 'single' ? 'bulb' : 'strip')); setLedCount(nextCount ?? (nextKind === 'single' ? 1 : 60));
    if (manual) { setProfileSource('manual'); setProfileReason('Указано вручную') }
    if (nextKind === 'single' && ['gradient', 'chase', 'music'].includes(mode)) { setMode('static'); setActiveScene('warm') }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const nav = navigator as Navigator & { bluetooth?: { requestDevice: (options: unknown) => Promise<unknown> } };
      let next: BleDevice;
      if (nav.bluetooth) {
        const native = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb', '0000ffd0-0000-1000-8000-00805f9b34fb'] });
        next = new WebBleDevice(native);
      } else next = new MockBleDevice('demo-strip', 'NEON-STRIP-01', ['0000ffe0-0000-1000-8000-00805f9b34fb']);
      await next.connect(); setDevice(next); setProtocol(identifyProtocol(next, () => undefined));
      const detected = inferProfile(next); setProfile(detected.kind, detected.shape, detected.count, false); setProfileSource('auto'); setProfileReason(detected.reason); setSettingsOpen(true); setNotice('Устройство распознано — проверьте профиль');
    } catch { setNotice('Подключение отменено') } finally { setConnecting(false) }
  };

  const disconnect = async () => { await device?.disconnect(); setDevice(null); setProtocol(null); setProfileSource('manual'); setProfileReason('Не подключено') };
  const togglePower = async () => { const next = !power; setPower(next); if (protocol) next ? await protocol.turnOn() : await protocol.turnOff() };
  const chooseScene = async (next: Scene) => {
    setActiveScene(next.id); setMode(next.mode); setColor(next.colors[0]); if (next.colors[1]) setSecondColor(next.colors[1]); setPlaying(true);
    if (protocol) { await protocol.setRGB(...hexToRgb(next.colors[0])); if (kind === 'multi') await protocol.setEffect(next.effect) }
  };
  const chooseColor = async (next: string, secondary = false) => { secondary ? setSecondColor(next) : setColor(next); setActiveScene('custom'); if (!secondary && protocol) await protocol.setRGB(...hexToRgb(next)) };
  const selectMode = async (next: ModeId) => {
    setMode(next); setActiveScene('custom'); setPlaying(true);
    if (!protocol) return;
    if (next === 'sequence') return;
    if (kind === 'single') {
      // Start from a known visible color; the animation loop handles subsequent frames.
      const [r, g, b] = hexToRgb(color);
      const scale = brightness / 100;
      await protocol.setRGB(Math.round(r * scale), Math.round(g * scale), Math.round(b * scale));
      return;
    }
    if (next === 'music') await protocol.setMusicMode(true);
    else await protocol.setEffect({ breathe: '37', pulse: '38', flicker: '1', strobe: '39', sequence: '1', gradient: '40', chase: '41', static: '1' }[next] ?? '1');
  };
  const addSequenceColor = () => setSequenceColors(colors => colors.length < 8 ? [...colors, '#ffffff'] : colors);
  const changeSequenceColor = (index: number, value: string) => setSequenceColors(colors => colors.map((item, i) => i === index ? value : item));
  const moveSequenceColor = (index: number, direction: -1 | 1) => setSequenceColors(colors => { const target = index + direction; if (target < 0 || target >= colors.length) return colors; const next = [...colors]; [next[index], next[target]] = [next[target], next[index]]; return next });
  const removeSequenceColor = (index: number) => setSequenceColors(colors => colors.length > 2 ? colors.filter((_, i) => i !== index) : colors);
  const saveScenario = () => {
    const name = scenarioName.trim() || `Мой сценарий ${customScenes.length + 1}`;
    const colors = mode === 'sequence' ? sequenceColors : [color, ...(kind === 'multi' && ['gradient','chase'].includes(mode) ? [secondColor] : [])];
    setCustomScenes(items => [...items, { id: crypto.randomUUID(), name, kind, mode, colors, brightness, speed, frequency, pulseWidth, transition, sequencePlayback }]);
    setScenarioName(''); setNotice(`Сценарий «${name}» сохранён`);
  };
  const loadCustomScene = (item: CustomScene) => {
    setKind(item.kind); setShape(item.kind === 'single' ? 'bulb' : shape); setMode(item.mode); setBrightness(item.brightness); setSpeed(item.speed); setFrequency(item.frequency); setPulseWidth(item.pulseWidth); setTransition(item.transition); setSequencePlayback(item.sequencePlayback); setActiveScene('custom'); setPlaying(true);
    if (item.mode === 'sequence') setSequenceColors(item.colors); else { setColor(item.colors[0]); if (item.colors[1]) setSecondColor(item.colors[1]) }
    setNotice(`Запущен сценарий «${item.name}»`);
  };
  const startTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (!timerMinutes) { setRemaining(0); setNotice('Таймер отключён'); return }
    setRemaining(timerMinutes * 60); setNotice(`Выключение через ${timerMinutes} мин.`);
    timerRef.current = window.setInterval(() => setRemaining(value => { if (value <= 1) { if (timerRef.current) clearInterval(timerRef.current); setPower(false); protocol?.turnOff(); return 0 } return value - 1 }), 1000);
  };

  const animationStyle = { '--scene-gradient': `linear-gradient(105deg, ${palette.join(', ')})`, '--anim-duration': `${Math.max(.15, 2.2 - speed / 55)}s`, '--flash-duration': `${1 / frequency}s`, '--pulse-width': `${pulseWidth}%`, '--transition': `${transition}ms` } as React.CSSProperties;
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark"><Lightbulb size={19}/></span><span>SVETI</span></a><div className="device-status">{device ? <><span className="status-dot"/><span className="device-copy"><strong>{device.name}</strong><small>{kind === 'single' ? '1 LED' : `${ledCount} LED`} · подключено</small></span><button className="icon-button" onClick={disconnect} aria-label="Отключить"><Unplug size={18}/></button></> : <button className="connect-button" onClick={connect} disabled={connecting}><Bluetooth size={18}/>{connecting ? 'Определяем…' : 'Подключить устройство'}</button>}</div></header>
    <main id="top">
      <section className={`light-stage ${power ? '' : 'is-off'} ${playing ? `mode-${mode}` : ''}`} style={animationStyle}><div className="stage-glow"/><div className="stage-copy"><p className="eyebrow"><Radio size={14}/>{device ? 'Свет в реальном времени' : 'Предпросмотр'}</p><h1>{scene && activeScene !== 'custom' ? scene.name : availableModes.find(item => item.id === mode)?.label}</h1><p>{power ? `${kind === 'single' ? 'Одиночная лампа' : `${ledCount} адресных LED`} · ${playing ? 'сценарий активен' : 'пауза'}` : 'Свет выключен'}</p>{remaining > 0 && <div className="timer-badge"><Clock3 size={14}/> {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} до выключения</div>}</div><div className="led-preview"><div className={`light-object ${shape}`}>{Array.from({ length: previewCount }).map((_, i) => <i key={i} style={{ '--i': i, '--n': previewCount } as React.CSSProperties}/>)}</div></div><button className={`power-button ${power ? 'active' : ''}`} onClick={togglePower}><Power size={25}/></button></section>

      <section className="control-card profile-summary"><div><span className="profile-icon"><Wand2 size={18}/></span><div><b>{kind === 'single' ? 'Одиночная LED-лампа' : 'Адресное LED-устройство'}</b><small><em>{profileSource === 'auto' ? 'Определено автоматически' : 'Ручной профиль'}</em> · {profileReason}</small></div></div><button className="text-button" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={17}/>Изменить</button></section>

      {settingsOpen && <section className="control-card device-settings"><div className="section-heading"><div><span>ПРОФИЛЬ УСТРОЙСТВА</span><h2>Что подключено?</h2></div><ChevronDown size={20}/></div><div className="profile-choice"><button className={kind === 'single' ? 'selected' : ''} onClick={() => setProfile('single')}><Lightbulb/><strong>Одна лампа</strong><small>Один цвет на всём устройстве</small></button><button className={kind === 'multi' ? 'selected' : ''} onClick={() => setProfile('multi')}><Sparkles/><strong>Несколько LED</strong><small>Градиенты и движение по пикселям</small></button></div>{kind === 'multi' && <div className="settings-row"><div><label>Форма</label><div className="segmented">{(['strip','matrix','ring'] as DeviceShape[]).map(item => <button key={item} className={shape === item ? 'selected' : ''} onClick={() => { setShape(item); setProfileSource('manual') }}>{item === 'strip' ? 'Лента' : item === 'matrix' ? 'Матрица' : 'Кольцо'}</button>)}</div></div><div><label>Количество LED</label><input type="number" min="2" max="1024" value={ledCount} onChange={e => { setLedCount(Number(e.target.value)); setProfileSource('manual') }}/></div></div>}</section>}

      <section className="control-card"><div className="section-heading"><div><span>СЦЕНЫ ДЛЯ ЭТОГО УСТРОЙСТВА</span><h2>Выберите настроение</h2></div></div><div className={`scene-grid count-${availableScenes.length}`}>{availableScenes.map(item => <button key={item.id} className={`scene-tile ${activeScene === item.id ? 'selected' : ''}`} onClick={() => chooseScene(item)}><span className="scene-art" style={{background:`linear-gradient(135deg,${item.colors.join(',')})`}}/><span className="scene-info"><strong>{item.name}</strong><small>{item.description}</small></span>{activeScene === item.id && <span className="check"><Check size={14}/></span>}</button>)}</div></section>

      <section className="control-card"><div className="section-heading"><div><span>РЕЖИМ</span><h2>Как должен работать свет</h2></div></div><div className="mode-tabs">{availableModes.map(item => <button key={item.id} className={mode === item.id ? 'selected' : ''} onClick={() => selectMode(item.id)}>{item.label}</button>)}</div><div className="controls-grid advanced">
        <div className="control-group"><label>Цвет</label><div className="color-row">{['#ff7a45','#ffd36a','#54efaa','#28d7ff','#8d5cff','#ff3d81'].map(s => <button key={s} className={`swatch ${color === s ? 'selected' : ''}`} style={{background:s}} onClick={() => chooseColor(s)} aria-label={`Цвет ${s}`}/>)}<label className="custom-color" style={{background:color}}><span>+</span><input type="color" value={color} onChange={e => chooseColor(e.target.value)}/></label>{kind === 'multi' && ['gradient','chase'].includes(mode) && <label className="custom-color secondary" style={{background:secondColor}} title="Второй цвет"><input type="color" value={secondColor} onChange={e => chooseColor(e.target.value, true)}/></label>}</div></div>
        <Range label="Яркость" value={brightness} min={1} max={100} unit="%" onChange={value => { setBrightness(value); protocol?.setBrightness(value) }}/>
        {mode !== 'static' && <Range label="Скорость" value={speed} min={1} max={100} unit="%" onChange={value => { setSpeed(value); protocol?.setSpeed(value / 100) }}/>}<button className="play-button" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={19}/> : <Play size={19}/>} {playing ? 'Пауза' : 'Запустить'}</button>
      </div></section>

      {mode === 'sequence' && <section className="control-card sequence-card"><div className="section-heading"><div><span>ОЧЕРЕДЬ ЦВЕТОВ</span><h2>Соберите последовательность</h2></div><button className="text-button" onClick={addSequenceColor} disabled={sequenceColors.length >= 8}><Plus size={17}/>Добавить цвет</button></div><div className="sequence-list">{sequenceColors.map((item, index) => <div className="sequence-item" key={`${index}-${item}`}><span className="sequence-number">{index + 1}</span><label className="sequence-color" style={{background:item}}><input type="color" value={item} onChange={event => changeSequenceColor(index, event.target.value)}/></label><code>{item.toUpperCase()}</code><div className="sequence-actions"><button onClick={() => moveSequenceColor(index, -1)} disabled={index === 0} aria-label="Выше"><ArrowUp size={15}/></button><button onClick={() => moveSequenceColor(index, 1)} disabled={index === sequenceColors.length - 1} aria-label="Ниже"><ArrowDown size={15}/></button><button onClick={() => removeSequenceColor(index)} disabled={sequenceColors.length <= 2} aria-label="Удалить"><Trash2 size={15}/></button></div></div>)}</div><div className="sequence-options"><div><label>Воспроизведение</label><div className="segmented"><button className={sequencePlayback === 'loop' ? 'selected' : ''} onClick={() => setSequencePlayback('loop')}>По кругу</button><button className={sequencePlayback === 'once' ? 'selected' : ''} onClick={() => setSequencePlayback('once')}>Один проход</button></div></div><Range label="Время одного цвета" value={sequenceSeconds} min={.5} max={10} step={.5} unit=" сек" onChange={setSequenceSeconds}/><Range label="Плавность перехода" value={transition} min={100} max={3000} step={100} unit=" мс" onChange={setTransition}/></div></section>}

      {['breathe','pulse','strobe'].includes(mode) && <section className="control-card timing-card"><div className="section-heading"><div><span>ТАЙМИНГ</span><h2>Ритм и длительность</h2></div></div><div className="timing-grid"><Range label="Частота" value={frequency} min={.2} max={mode === 'strobe' ? 5 : 2} step={.1} unit=" Гц" onChange={setFrequency}/><Range label="Длительность импульса" value={pulseWidth} min={10} max={90} unit="%" onChange={setPulseWidth}/><Range label="Плавность перехода" value={transition} min={0} max={2000} step={50} unit=" мс" onChange={setTransition}/></div>{mode === 'strobe' && <p className="safety-note">Частота ограничена 5 Гц. Не используйте мигание рядом с людьми с фоточувствительностью.</p>}</section>}

      <section className="control-card timer-card"><div className="section-heading"><div><span>ТАЙМЕР</span><h2>Автоматическое выключение</h2></div></div><div className="timer-row">{[0,15,30,60,120].map(value => <button key={value} className={timerMinutes === value ? 'selected' : ''} onClick={() => setTimerMinutes(value)}>{value === 0 ? 'Без таймера' : `${value} мин`}</button>)}<button className="timer-start" onClick={startTimer}><Clock3 size={16}/>{remaining ? 'Обновить' : 'Запустить'}</button></div></section>

      <section className="control-card custom-scenes"><div className="section-heading"><div><span>МОИ СЦЕНАРИИ</span><h2>Сохраните текущую настройку</h2></div></div><div className="save-scenario"><input value={scenarioName} onChange={event => setScenarioName(event.target.value)} placeholder="Название сценария" maxLength={32}/><button onClick={saveScenario}><Save size={16}/>Сохранить</button></div>{customScenes.length > 0 ? <div className="custom-list">{customScenes.map(item => <div className="custom-item" key={item.id}><button className="custom-play" onClick={() => loadCustomScene(item)}><span className="custom-palette">{item.colors.slice(0,4).map((value, index) => <i key={index} style={{background:value}}/>)}</span><span><strong>{item.name}</strong><small>{modes.find(modeItem => modeItem.id === item.mode)?.label} · {item.kind === 'single' ? '1 LED' : 'несколько LED'}</small></span><Play size={16}/></button><button className="custom-delete" onClick={() => setCustomScenes(items => items.filter(sceneItem => sceneItem.id !== item.id))} aria-label={`Удалить ${item.name}`}><Trash2 size={15}/></button></div>)}</div> : <p className="empty-state">Настройте свет и сохраните первый собственный сценарий.</p>}</section>
    </main>{notice && <div className="toast">{notice}</div>}
  </div>;
}

function Range({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  return <div className="control-group"><div className="range-label"><label>{label}</label><output>{value}{unit}</output></div><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></div>;
}
