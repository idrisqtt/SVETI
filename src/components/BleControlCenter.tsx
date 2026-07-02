import React, { useState, useEffect, useRef } from 'react';
import { Radio, Bluetooth, RefreshCw, Sliders, Trash2, Power, Music, Play, Square, PlusCircle, ChevronUp, ChevronDown, Timer } from 'lucide-react';
import type { BleDevice } from '../utils/ble/bleDevice';
import { WebBleDevice, MockBleDevice, WifiDevice } from '../utils/ble/bleDevice';
import type { LedProtocol } from '../utils/ble/protocols';
import { identifyProtocol, DuoCoProtocol, HappyLightingProtocol, BanlanXProtocol, GoveeProtocol, GenericBleProtocol } from '../utils/ble/protocols';

interface BleControlCenterProps {
  t: (key: any) => string;
  language: string;
  activeDevice: BleDevice | null;
  activeProtocol: LedProtocol | null;
  onConnectDevice: (device: BleDevice) => Promise<void>;
  onDisconnectDevice: () => Promise<void>;
}

type SubTab = 'scan' | 'controls' | 'scenarios';

export const BleControlCenter: React.FC<BleControlCenterProps> = ({
  t,
  language: _language,
  activeDevice,
  activeProtocol: propProtocol,
  onConnectDevice,
  onDisconnectDevice,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('scan');
  const [isConnecting, setIsConnecting] = useState(false);
  const [mockDevicesList, setMockDevicesList] = useState<any[]>([
    { id: 'mock-strip', name: 'NEON-STRIP-01', mac: 'AC:DE:81', rssi: -42, serviceUuids: ['0000fff0-0000-1000-8000-00805f9b34fb'] },
    { id: 'mock-matrix', name: 'MATRIX-PANEL', mac: '7F:22:9A', rssi: -67, serviceUuids: ['0000ffe0-0000-1000-8000-00805f9b34fb'] }
  ]);

  // WiFi Device connection states
  const customWifiName = 'NEON-STRIP-01';
  const [customWifiIp, setCustomWifiIp] = useState('192.168.1.42');
  const [customWifiPort, setCustomWifiPort] = useState('8888');
  
  // Hardware dashboard control states
  const [powerState, setPowerState] = useState(true);
  const [brightness, setBrightness] = useState(100);
  const [colorVal, setColorVal] = useState('#8b5cf6');
  const [colorTemp, setColorTemp] = useState(4000);
  const [effectId, setEffectId] = useState('1');
  const [speed, setSpeed] = useState(0.5);
  const [musicMode, setMusicMode] = useState(false);

  // Dynamic Profile Override states
  const [selectedProfile, setSelectedProfile] = useState<string>('auto');
  const [localProtocol, setLocalProtocol] = useState<LedProtocol | null>(null);

  const activeProtocol = localProtocol || propProtocol;

  // Instantiation logic
  useEffect(() => {
    if (!activeDevice) {
      setLocalProtocol(null);
      return;
    }

    const trafficCb = () => {};

    if (selectedProfile === 'auto') {
      setLocalProtocol(identifyProtocol(activeDevice, trafficCb));
    } else {
      let proto: LedProtocol;
      switch (selectedProfile) {
        case 'duoco':
          proto = new DuoCoProtocol(activeDevice, trafficCb);
          break;
        case 'happy':
          proto = new HappyLightingProtocol(activeDevice, trafficCb);
          break;
        case 'banlan':
          proto = new BanlanXProtocol(activeDevice, trafficCb);
          break;
        case 'govee':
          proto = new GoveeProtocol(activeDevice, trafficCb);
          break;
        default:
          proto = new GenericBleProtocol(activeDevice, trafficCb);
      }
      setLocalProtocol(proto);
    }
  }, [activeDevice, selectedProfile]);

  // Scenario Builder states
  interface ScenarioStep {
    id: string;
    type: 'fade' | 'pulse' | 'flicker' | 'strobe' | 'delay';
    color1: string;
    color2: string;
    duration: number; // in seconds
    speed: number;
  }

  const [scenariosList, setScenariosList] = useState<ScenarioStep[]>([
    { id: '1', type: 'fade', color1: '#ff5500', color2: '#000000', duration: 4, speed: 1 },
    { id: '2', type: 'delay', color1: '#000000', color2: '#000000', duration: 2, speed: 1 }
  ]);
  const [isPlayingScenario, setIsPlayingScenario] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [loopScenario, setLoopScenario] = useState(true);

  const runAnimRef = useRef<number | null>(null);

  const startScenario = () => {
    if (scenariosList.length === 0 || !activeProtocol) return;
    setIsPlayingScenario(true);
    
    stopScenario();

    let stepIndex = 0;
    let lastR = 0, lastG = 0, lastB = 0;

    const runNext = async (idx: number) => {
      if (idx >= scenariosList.length) {
        if (loopScenario) {
          runNext(0);
        } else {
          setIsPlayingScenario(false);
          setActiveStepId(null);
        }
        return;
      }

      const step = scenariosList[idx];
      setActiveStepId(step.id);

      const parseHex = (hex: string) => {
        const clean = hex.replace('#', '');
        return {
          r: parseInt(clean.substring(0, 2), 16) || 0,
          g: parseInt(clean.substring(2, 4), 16) || 0,
          b: parseInt(clean.substring(4, 6), 16) || 0
        };
      };

      const c1 = parseHex(step.color1);
      const c2 = parseHex(step.color2);

      const durationMs = step.duration * 1000;
      const startTime = Date.now();

      if (step.type === 'fade') {
        const startR = lastR;
        const startG = lastG;
        const startB = lastB;

        const interval = window.setInterval(async () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(1, elapsed / durationMs);

          const r = Math.round(startR + (c1.r - startR) * progress);
          const g = Math.round(startG + (c1.g - startG) * progress);
          const b = Math.round(startB + (c1.b - startB) * progress);

          try {
            await activeProtocol.setRGB(r, g, b);
            lastR = r; lastG = g; lastB = b;
          } catch (e) {
            console.error(e);
          }

          if (progress >= 1) {
            window.clearInterval(interval);
            runNext(idx + 1);
          }
        }, 100);

        runAnimRef.current = interval;
      } 
      else if (step.type === 'pulse') {
        const interval = window.setInterval(async () => {
          const elapsed = Date.now() - startTime;
          const progress = elapsed / durationMs;

          const tVal = elapsed / 1000;
          const factor = (Math.sin(tVal * step.speed * Math.PI * 2) + 1) / 2;

          const r = Math.round(c1.r + (c2.r - c1.r) * factor);
          const g = Math.round(c1.g + (c2.g - c1.g) * factor);
          const b = Math.round(c1.b + (c2.b - c1.b) * factor);

          try {
            await activeProtocol.setRGB(r, g, b);
            lastR = r; lastG = g; lastB = b;
          } catch (e) {
            console.error(e);
          }

          if (progress >= 1) {
            window.clearInterval(interval);
            runNext(idx + 1);
          }
        }, 80);

        runAnimRef.current = interval;
      } 
      else if (step.type === 'flicker') {
        const interval = window.setInterval(async () => {
          const elapsed = Date.now() - startTime;
          const progress = elapsed / durationMs;

          const factor = Math.random();
          const r = Math.round(200 + factor * 55);
          const g = Math.round(100 + factor * 80);
          const b = Math.round(factor * 20);

          try {
            await activeProtocol.setRGB(r, g, b);
            lastR = r; lastG = g; lastB = b;
          } catch (e) {
            console.error(e);
          }

          if (progress >= 1) {
            window.clearInterval(interval);
            runNext(idx + 1);
          }
        }, 120);

        runAnimRef.current = interval;
      } 
      else if (step.type === 'strobe') {
        let flash = false;
        const flashRate = Math.round(1000 / (step.speed * 2));

        const interval = window.setInterval(async () => {
          const elapsed = Date.now() - startTime;
          const progress = elapsed / durationMs;

          flash = !flash;
          const r = flash ? c1.r : c2.r;
          const g = flash ? c1.g : c2.g;
          const b = flash ? c1.b : c2.b;

          try {
            await activeProtocol.setRGB(r, g, b);
            lastR = r; lastG = g; lastB = b;
          } catch (e) {
            console.error(e);
          }

          if (progress >= 1) {
            window.clearInterval(interval);
            runNext(idx + 1);
          }
        }, flashRate);

        runAnimRef.current = interval;
      } 
      else { // delay
        const timeout = window.setTimeout(() => {
          runNext(idx + 1);
        }, durationMs);

        runAnimRef.current = timeout;
      }
    };

    runNext(stepIndex);
  };

  const stopScenario = () => {
    if (runAnimRef.current) {
      window.clearInterval(runAnimRef.current);
      window.clearTimeout(runAnimRef.current);
      runAnimRef.current = null;
    }
    setIsPlayingScenario(false);
    setActiveStepId(null);
  };

  useEffect(() => {
    return () => {
      if (runAnimRef.current) {
        window.clearInterval(runAnimRef.current);
        window.clearTimeout(runAnimRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeDevice) {
      setActiveSubTab('controls');
    } else {
      setActiveSubTab('scan');
    }
  }, [activeDevice]);

  const startScan = async () => {
    setMockDevicesList([]);
    setIsConnecting(true);

    const simTimeout = window.setTimeout(() => {
      setIsConnecting(false);
      setMockDevicesList([
        { id: 'mock-strip', name: 'NEON-STRIP-01', mac: 'AC:DE:81', rssi: -42, serviceUuids: ['0000fff0-0000-1000-8000-00805f9b34fb'] },
        { id: 'mock-matrix', name: 'MATRIX-PANEL', mac: '7F:22:9A', rssi: -67, serviceUuids: ['0000ffe0-0000-1000-8000-00805f9b34fb'] }
      ]);
    }, 1200);

    try {
      const nav = navigator as any;
      if (nav.bluetooth) {
        const nativeDevice = await nav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            '0000ffe0-0000-1000-8000-00805f9b34fb', // BanlanX, SP110E
            '0000fff0-0000-1000-8000-00805f9b34fb', // DuoCo, ELK-BLEDOM
            '0000ffd0-0000-1000-8000-00805f9b34fb', // HappyLighting, Triones
            '00010203-0405-0607-0809-0a0b0c0d1910', // Govee
            '0000f30d-0000-1000-8000-00805f9b34fb', // Generic LED
            '0000ae30-0000-1000-8000-00805f9b34fb', // Common LED
            '0000ffd5-0000-1000-8000-00805f9b34fb', // DuoCo Variant
            '0000fff3-0000-1000-8000-00805f9b34fb', // DuoCo Variant 2
            '0000ffe5-0000-1000-8000-00805f9b34fb', // SP108E, SP107E
            '0000180f-0000-1000-8000-00805f9b34fb', // Battery
            '0000180a-0000-1000-8000-00805f9b34fb'  // Device Info
          ]
        });
        window.clearTimeout(simTimeout);
        const webDevice = new WebBleDevice(nativeDevice);
        await handleConnect(webDevice);
      }
    } catch (err: any) {
      console.warn('Native scan cancelled or failed, using mock list:', err);
    }
  };

  const handleConnectMock = async (mock: { id: string, name: string, serviceUuids: string[], mac: string }) => {
    setIsConnecting(true);
    try {
      const mockDevice = new MockBleDevice(mock.id, mock.name, mock.serviceUuids, mock.mac);
      await handleConnect(mockDevice);
    } catch (err: any) {
      alert(`Mock connection failed: ${err.message}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnectWifi = async (name: string, ip: string) => {
    setIsConnecting(true);
    try {
      const wifiDevice = new WifiDevice(`wifi-${ip.replace(/\./g, '-')}`, name, ip);
      await handleConnect(wifiDevice);
    } catch (err: any) {
      alert(`WiFi connection failed: ${err.message}`);
    } finally {
      setIsConnecting(false);
    }
  };



  const handleConnect = async (device: BleDevice) => {
    setIsConnecting(true);
    try {
      await onConnectDevice(device);
    } catch (err: any) {
      alert(`Connection failed: ${err.message}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const togglePower = async () => {
    if (!activeProtocol) return;
    const nextPower = !powerState;
    try {
      if (nextPower) {
        await activeProtocol.turnOn();
      } else {
        await activeProtocol.turnOff();
      }
      setPowerState(nextPower);
    } catch (err: any) {
      console.error('Power state toggle failed', err);
      alert(`Power state toggle failed: ${err.message}`);
    }
  };

  const handleBrightnessChange = async (val: number) => {
    setBrightness(val);
    if (!activeProtocol) return;
    try {
      await activeProtocol.setBrightness(val);
    } catch (err: any) {
      console.error('Brightness write failed', err);
    }
  };

  const handleColorChange = async (hex: string) => {
    setColorVal(hex);
    if (!activeProtocol) return;
    try {
      const cleanHex = hex.replace('#', '');
      const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
      const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
      const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
      await activeProtocol.setRGB(r, g, b);
    } catch (err: any) {
      console.error('Color write failed', err);
    }
  };

  const handleColorTempChange = async (kelvin: number) => {
    setColorTemp(kelvin);
    if (!activeProtocol) return;
    try {
      await activeProtocol.setColorTemperature(kelvin);
    } catch (err: any) {
      console.error('Color temperature write failed', err);
    }
  };

  const handleEffectChange = async (eff: string) => {
    setEffectId(eff);
    if (!activeProtocol) return;
    try {
      await activeProtocol.setEffect(eff);
    } catch (err: any) {
      console.error('Effect write failed', err);
    }
  };

  const handleSpeedChange = async (spd: number) => {
    setSpeed(spd);
    if (!activeProtocol) return;
    try {
      await activeProtocol.setSpeed(spd);
    } catch (err: any) {
      console.error('Speed write failed', err);
    }
  };

  const toggleMusicMode = async () => {
    if (!activeProtocol) return;
    const nextMusic = !musicMode;
    try {
      await activeProtocol.setMusicMode(nextMusic);
      setMusicMode(nextMusic);
    } catch (err: any) {
      console.error('Music mode write failed', err);
    }
  };

  const getProtocolTagColor = (pName: string) => {
    switch (pName) {
      case 'DuoCoProtocol': return 'text-purple-400';
      case 'HappyLightingProtocol': return 'text-pink-400';
      case 'BanlanXProtocol': return 'text-cyan-400';
      case 'GoveeProtocol': return 'text-green-400';
      default: return 'text-zinc-500';
    }
  };

  // Connected Details component block
  const ConnectedDeviceDetails = () => (
    <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex flex-col gap-3">
      <div className="flex justify-between items-center border-b border-white/5 pb-2">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
          <Bluetooth size={14} className="text-primary" />
          {t('bleDeviceDetails')}
        </h3>
        <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded font-bold uppercase">
          {t('bleConnected')}
        </span>
      </div>
      
      <div className="flex flex-col gap-2 text-xs">
        <h4 className="text-sm font-bold text-white">{activeDevice?.name}</h4>
        <div className="grid grid-cols-1 gap-2 text-zinc-400 font-medium">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">ID / UUID</span>
            <span className="font-mono text-[10px] truncate">{activeDevice?.id}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">MAC Address</span>
            <span className="font-mono text-[10px]">{activeDevice?.mac || 'Unknown'}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-500">Profile Type</span>
            <span className={`font-bold ${getProtocolTagColor(activeProtocol?.constructor.name || '')}`}>
              {activeProtocol?.constructor.name.replace('Protocol', '') || 'Generic'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-white/5 pt-3">
        <label className="text-[10px] text-zinc-500 font-bold uppercase">Manual Profile Override</label>
        <select
          value={selectedProfile}
          onChange={(e) => setSelectedProfile(e.target.value)}
          className="w-full bg-zinc-950/60 border border-white/5 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-primary transition-colors cursor-pointer"
        >
          <option value="auto">Auto-Detect Protocol</option>
          <option value="duoco">DuoCo / ELK-BLEDOM</option>
          <option value="happy">HappyLighting / Triones</option>
          <option value="banlan">BanlanX (SP110E)</option>
          <option value="govee">Govee H6125</option>
          <option value="generic">Generic LED (Hex format)</option>
        </select>
      </div>

      <button
        onClick={onDisconnectDevice}
        className="w-full mt-2 py-2 rounded-xl border border-red-500/20 hover:bg-red-500/10 text-red-400 hover:text-red-300 text-xs font-bold transition-all"
      >
        {t('bleDisconnect')}
      </button>
    </div>
  );



  return (
    <div className="flex flex-col gap-4">
      
      {/* Sub tabs navigation Segment controller - Only show on mobile */}
      <div className="grid grid-cols-3 gap-1 p-0.5 bg-black/45 border border-white/5 rounded-xl md:hidden shrink-0">
        {activeDevice ? (
          <>
            <button
              onClick={() => setActiveSubTab('controls')}
              className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeSubTab === 'controls' 
                ? 'bg-primary text-white shadow-md' 
                : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Sliders size={12} /> Controller
            </button>
            <button
              onClick={() => setActiveSubTab('scenarios')}
              className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeSubTab === 'scenarios' 
                ? 'bg-primary text-white shadow-md' 
                : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Timer size={12} /> Scenarios
            </button>
            <button
              onClick={() => setActiveSubTab('scan')}
              className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeSubTab === 'scan' 
                ? 'bg-primary text-white shadow-md' 
                : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Radio size={12} /> Settings
            </button>
          </>
        ) : (
          <button
            onClick={() => setActiveSubTab('scan')}
            className="col-span-3 py-2 text-xs font-bold rounded-lg bg-primary text-white flex items-center justify-center gap-1.5"
          >
            <Radio size={12} /> {t('bleScanner')}
          </button>
        )}
      </div>

      {/* Responsive layout viewport split */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start w-full">
        
        {/* Left Column: Device Info details */}
        <div className="md:col-span-1 flex flex-col gap-4 w-full">
          {activeDevice ? (
            <ConnectedDeviceDetails />
          ) : (
            <div className="hidden md:flex p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex-col gap-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Bluetooth size={14} className="text-primary" />
                Connection Manager
              </h3>
              <p className="text-[11px] text-zinc-500 leading-normal">
                No active smart light controllers connected. Use the radar scanner to search and pair physical devices.
              </p>
              <button
                onClick={startScan}
                disabled={isConnecting}
                className="w-full py-2 bg-primary hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-[0_0_10px_var(--primary-glow)] disabled:opacity-40"
              >
                <RefreshCw size={12} className={isConnecting ? 'animate-spin' : ''} />
                {isConnecting ? t('bleConnecting') : t('bleStartScan')}
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Dynamic tab content & Scanner swept radar */}
        <div className="md:col-span-2 flex flex-col gap-4 w-full">
          
          {/* Desktop tab buttons switcher */}
          {activeDevice && (
            <div className="hidden md:grid grid-cols-2 gap-1 p-0.5 bg-black/45 border border-white/5 rounded-xl shrink-0">
              <button
                onClick={() => setActiveSubTab('controls')}
                className={`py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  activeSubTab === 'controls' || activeSubTab === 'scan'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Sliders size={12} /> Controller Controls
              </button>
              <button
                onClick={() => setActiveSubTab('scenarios')}
                className={`py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  activeSubTab === 'scenarios'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Timer size={12} /> Scenario Builder
              </button>
            </div>
          )}

          {/* Connected state Content */}
          {activeDevice ? (
            <>
              {/* Controls Tab */}
              {(activeSubTab === 'controls' || activeSubTab === 'scan') && (
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex flex-col gap-4 animate-fade-in">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2.5">
                    <div>
                      <h3 className="text-sm font-bold text-white">{activeDevice.name}</h3>
                      <span className="text-[10px] text-zinc-500">Live Device Dashboard</span>
                    </div>

                    {/* Power Toggle Button */}
                    <button
                      onClick={togglePower}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all ${
                        powerState 
                        ? 'bg-green-500/15 border-green-500/35 text-green-400 shadow-[0_0_12px_rgba(34,197,94,0.2)]' 
                        : 'bg-red-500/15 border-red-500/35 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.15)]'
                      }`}
                    >
                      <Power size={16} />
                    </button>
                  </div>

                  {/* Color picker */}
                  <div className="flex flex-col gap-3">
                    <label className="text-[10px] text-zinc-500 font-bold uppercase">{t('colorSelector')}</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={colorVal}
                        onChange={(e) => handleColorChange(e.target.value)}
                        className="w-14 h-10 border-none rounded-xl cursor-pointer bg-transparent shrink-0"
                      />
                      <input
                        type="text"
                        value={colorVal}
                        onChange={(e) => handleColorChange(e.target.value)}
                        className="w-full bg-zinc-950/60 border border-white/5 rounded-xl px-3 py-2 text-sm text-white font-mono uppercase tracking-wider focus:outline-none focus:border-primary transition-colors"
                      />
                    </div>

                    {/* Quick color preset palette */}
                    <div className="flex flex-wrap gap-2 mt-1">
                      {[
                        { name: 'Red', hex: '#ff003c' },
                        { name: 'Green', hex: '#00ff66' },
                        { name: 'Blue', hex: '#0066ff' },
                        { name: 'Purple', hex: '#8b5cf6' },
                        { name: 'Pink', hex: '#ec4899' },
                        { name: 'Orange', hex: '#f97316' },
                        { name: 'Yellow', hex: '#eab308' },
                        { name: 'Warm', hex: '#fef08a' },
                        { name: 'Cool', hex: '#e2e8f0' }
                      ].map((preset) => (
                        <button
                          key={preset.hex}
                          type="button"
                          onClick={() => handleColorChange(preset.hex)}
                          style={{ backgroundColor: preset.hex }}
                          className={`w-7 h-7 rounded-full border border-white/10 hover:scale-110 active:scale-95 transition-all shadow-[0_0_10px_rgba(0,0,0,0.4)] ${
                            colorVal.toLowerCase() === preset.hex.toLowerCase() 
                            ? 'ring-2 ring-primary ring-offset-2 ring-offset-black' 
                            : ''
                          }`}
                          title={preset.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Brightness / Speed settings */}
                  <div className="flex flex-col gap-4 border-t border-white/5 pt-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-400 font-medium">Device Brightness</span>
                        <span className="text-primary font-bold font-mono">{brightness}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={brightness}
                        onChange={(e) => handleBrightnessChange(Number(e.target.value))}
                        className="w-full accent-primary bg-zinc-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-400 font-medium">Device Speed</span>
                        <span className="text-primary font-bold font-mono">{Math.round(speed * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={speed}
                        onChange={(e) => handleSpeedChange(Number(e.target.value))}
                        className="w-full accent-primary bg-zinc-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Temperature Slider & Music React */}
                  <div className="flex flex-col gap-3.5 border-t border-white/5 pt-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-400 font-medium">White Balance Temperature</span>
                        <span className="text-cyan-400 font-bold font-mono">{colorTemp}K</span>
                      </div>
                      <input
                        type="range"
                        min="2700"
                        max="6500"
                        step="100"
                        value={colorTemp}
                        onChange={(e) => handleColorTempChange(Number(e.target.value))}
                        className="w-full accent-cyan-400 bg-zinc-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    <div className="flex gap-2 items-center">
                      <div className="flex-1 flex flex-col gap-1">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase">Hardware Effects</label>
                        <select
                          value={effectId}
                          onChange={(e) => handleEffectChange(e.target.value)}
                          className="w-full bg-zinc-950/60 border border-white/5 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-primary transition-colors cursor-pointer"
                        >
                          <option value="1">Rainbow Fade Strobe</option>
                          <option value="2">Cyberpunk Neon Flash</option>
                          <option value="3">Cozy Glow Ember Flickering</option>
                          <option value="4">Digital rain sequence</option>
                        </select>
                      </div>

                      <button
                        onClick={toggleMusicMode}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all mt-4 ${
                          musicMode 
                          ? 'bg-pink-500/15 border-pink-500/35 text-pink-400 shadow-[0_0_12px_rgba(236,72,153,0.2)]' 
                          : 'bg-black/35 border-white/5 text-zinc-500 hover:text-white'
                        }`}
                        title="Enable device microphone beat reactive mode"
                      >
                        <Music size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Scenarios Tab */}
              {activeSubTab === 'scenarios' && (
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex flex-col gap-4 animate-fade-in">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                      <Timer size={14} className="text-primary" />
                      Preset Scenario Runner
                    </h3>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={loopScenario}
                        onChange={(e) => setLoopScenario(e.target.checked)}
                        className="accent-primary"
                      />
                      <span className="text-zinc-400 font-medium">Loop</span>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <select
                      onChange={(e) => {
                        const preset = e.target.value;
                        if (preset === 'sunset') {
                          setScenariosList([
                            { id: 'step-1', type: 'fade', color1: '#ff5500', color2: '#000000', duration: 4, speed: 1 },
                            { id: 'step-2', type: 'fade', color1: '#aa2200', color2: '#000000', duration: 5, speed: 1 },
                            { id: 'step-3', type: 'fade', color1: '#000000', color2: '#000000', duration: 3, speed: 1 }
                          ]);
                        } else if (preset === 'police') {
                          setScenariosList([
                            { id: 'step-1', type: 'strobe', color1: '#ff0000', color2: '#000000', duration: 3, speed: 8 },
                            { id: 'step-2', type: 'strobe', color1: '#0000ff', color2: '#000000', duration: 3, speed: 8 }
                          ]);
                        } else if (preset === 'candle') {
                          setScenariosList([
                            { id: 'step-1', type: 'flicker', color1: '#ffaa00', color2: '#ff5500', duration: 15, speed: 1 }
                          ]);
                        } else if (preset === 'breath') {
                          setScenariosList([
                            { id: 'step-1', type: 'pulse', color1: '#8b5cf6', color2: '#06b6d4', duration: 10, speed: 0.5 }
                          ]);
                        }
                        e.target.value = '';
                      }}
                      className="flex-1 bg-zinc-955/60 border border-white/5 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
                    >
                      <option value="">-- Load Preset --</option>
                      <option value="sunset">🌅 Sunset Sleep</option>
                      <option value="police">🚨 Police Strobe</option>
                      <option value="candle">🕯️ Cozy Candle</option>
                      <option value="breath">🧘 Zen Breath</option>
                    </select>

                    <button
                      onClick={isPlayingScenario ? stopScenario : startScenario}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-md ${
                        isPlayingScenario 
                        ? 'bg-red-500 hover:bg-red-400 text-white shadow-red-500/10' 
                        : 'bg-primary hover:bg-purple-500 text-white shadow-purple-500/10'
                      }`}
                    >
                      {isPlayingScenario ? (
                        <>
                          <Square size={11} /> Stop
                        </>
                      ) : (
                        <>
                          <Play size={11} /> Play
                        </>
                      )}
                    </button>
                  </div>

                  {/* Scenario Step Cards Scroll area */}
                  <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                    {scenariosList.length === 0 ? (
                      <div className="text-center text-zinc-500 py-8 text-xs italic">
                        No steps added yet. Add steps below.
                      </div>
                    ) : (
                      scenariosList.map((step, index) => {
                        const isActive = isPlayingScenario && activeStepId === step.id;
                        return (
                          <div
                            key={step.id}
                            className={`p-3 rounded-xl border transition-all flex flex-col gap-2 ${
                              isActive 
                              ? 'bg-purple-950/15 border-purple-500/40 shadow-[0_0_12px_rgba(139,92,246,0.1)]' 
                              : 'bg-black/30 border-white/5'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-bold ${isActive ? 'text-primary' : 'text-zinc-500'}`}>
                                  #{index + 1}
                                </span>
                                <span className="text-xs font-bold text-white capitalize">
                                  {step.type === 'fade' && '🌈 Fade'}
                                  {step.type === 'pulse' && '💓 Pulse'}
                                  {step.type === 'flicker' && '🕯️ Flicker'}
                                  {step.type === 'strobe' && '⚡ Strobe'}
                                  {step.type === 'delay' && '⏱️ Delay'}
                                </span>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    if (index === 0) return;
                                    const list = [...scenariosList];
                                    const temp = list[index];
                                    list[index] = list[index - 1];
                                    list[index - 1] = temp;
                                    setScenariosList(list);
                                  }}
                                  disabled={index === 0}
                                  className="text-zinc-500 hover:text-white disabled:opacity-30"
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button
                                  onClick={() => {
                                    if (index === scenariosList.length - 1) return;
                                    const list = [...scenariosList];
                                    const temp = list[index];
                                    list[index] = list[index + 1];
                                    list[index + 1] = temp;
                                    setScenariosList(list);
                                  }}
                                  disabled={index === scenariosList.length - 1}
                                  className="text-zinc-500 hover:text-white disabled:opacity-30"
                                >
                                  <ChevronDown size={14} />
                                </button>
                                <button
                                  onClick={() => setScenariosList(prev => prev.filter(s => s.id !== step.id))}
                                  className="text-zinc-500 hover:text-red-400"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>

                            <div className="flex justify-between items-center gap-3 bg-black/20 p-1.5 rounded-lg border border-white/5">
                              {step.type !== 'delay' && step.type !== 'flicker' && (
                                <input
                                  type="color"
                                  value={step.color1}
                                  onChange={(e) => {
                                    const list = [...scenariosList];
                                    list[index].color1 = e.target.value;
                                    setScenariosList(list);
                                  }}
                                  className="w-7 h-6 border-none bg-transparent cursor-pointer shrink-0"
                                />
                              )}

                              {(step.type === 'pulse' || step.type === 'strobe') && (
                                <input
                                  type="color"
                                  value={step.color2}
                                  onChange={(e) => {
                                    const list = [...scenariosList];
                                    list[index].color2 = e.target.value;
                                    setScenariosList(list);
                                  }}
                                  className="w-7 h-6 border-none bg-transparent cursor-pointer shrink-0"
                                />
                              )}

                              <div className="flex items-center gap-1.5 ml-auto">
                                <span className="text-[9px] text-zinc-500 font-bold uppercase">Sec:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="60"
                                  value={step.duration}
                                  onChange={(e) => {
                                    const list = [...scenariosList];
                                    list[index].duration = Math.max(1, parseInt(e.target.value) || 1);
                                    setScenariosList(list);
                                  }}
                                  className="w-12 bg-zinc-950/60 border border-white/5 rounded-lg py-0.5 text-xs text-white font-mono text-center focus:outline-none"
                                />
                              </div>

                              {(step.type === 'pulse' || step.type === 'strobe') && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] text-zinc-500 font-bold uppercase">Hz:</span>
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    max="15"
                                    value={step.speed}
                                    onChange={(e) => {
                                      const list = [...scenariosList];
                                      list[index].speed = Math.max(0.1, parseFloat(e.target.value) || 0.1);
                                      setScenariosList(list);
                                    }}
                                    className="w-12 bg-zinc-950/60 border border-white/5 rounded-lg py-0.5 text-xs text-white font-mono text-center focus:outline-none"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Quick Actions Step Adders */}
                  <div className="border-t border-white/5 pt-3 flex flex-wrap gap-1.5 justify-center">
                    <button
                      onClick={() => setScenariosList(prev => [...prev, { id: 'step-' + Date.now(), type: 'fade', color1: '#3b82f6', color2: '#000000', duration: 4, speed: 1 }])}
                      className="px-2.5 py-1.5 rounded-xl border border-purple-500/10 bg-purple-500/5 hover:bg-purple-500/15 text-primary text-[10px] font-bold flex items-center gap-1 transition-all"
                    >
                      <PlusCircle size={11} /> + Fade
                    </button>
                    <button
                      onClick={() => setScenariosList(prev => [...prev, { id: 'step-' + Date.now(), type: 'pulse', color1: '#ec4899', color2: '#3b82f6', duration: 8, speed: 1 }])}
                      className="px-2.5 py-1.5 rounded-xl border border-pink-500/10 bg-pink-500/5 hover:bg-pink-500/15 text-secondary text-[10px] font-bold flex items-center gap-1 transition-all"
                    >
                      <PlusCircle size={11} /> + Pulse
                    </button>
                    <button
                      onClick={() => setScenariosList(prev => [...prev, { id: 'step-' + Date.now(), type: 'flicker', color1: '#ffaa00', color2: '#ff5500', duration: 10, speed: 1 }])}
                      className="px-2.5 py-1.5 rounded-xl border border-amber-500/10 bg-amber-500/5 hover:bg-amber-500/15 text-amber-400 text-[10px] font-bold flex items-center gap-1 transition-all"
                    >
                      <PlusCircle size={11} /> + Candle
                    </button>
                    <button
                      onClick={() => setScenariosList(prev => [...prev, { id: 'step-' + Date.now(), type: 'strobe', color1: '#ef4444', color2: '#000000', duration: 5, speed: 5 }])}
                      className="px-2.5 py-1.5 rounded-xl border border-red-500/10 bg-red-500/5 hover:bg-red-500/15 text-red-400 text-[10px] font-bold flex items-center gap-1 transition-all"
                    >
                      <PlusCircle size={11} /> + Strobe
                    </button>
                    <button
                      onClick={() => setScenariosList(prev => [...prev, { id: 'step-' + Date.now(), type: 'delay', color1: '#000000', color2: '#000000', duration: 3, speed: 1 }])}
                      className="px-2.5 py-1.5 rounded-xl border border-zinc-700/30 bg-zinc-800/10 hover:bg-zinc-800/25 text-zinc-400 text-[10px] font-bold flex items-center gap-1 transition-all"
                    >
                      <PlusCircle size={11} /> + Delay
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Disconnected state: render Dual Scanner (BLE Radar + WiFi Setup) */
            <div className="flex flex-col gap-6 animate-fade-in w-full max-w-sm mx-auto">
              {/* Header inside phone frame */}
              <div className="flex flex-col gap-1 mt-2">
                <h2 className="font-extrabold text-2xl text-white tracking-tight">Connect a device</h2>
                <p className="text-xs font-mono text-zinc-500">// choose a transport</p>
              </div>

              {/* CARD 1: BLE RADAR */}
              <div className="cyber-card cyber-card-glow p-5 rounded-2xl flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-xs font-bold text-accent uppercase font-mono tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00f0ff] shadow-[0_0_8px_#00f0ff] animate-ping" />
                    BLE RADAR
                  </span>
                  <span className="text-[10px] text-[#00f0ff]/50 font-bold uppercase font-mono tracking-wider animate-pulse">
                    SCANNING...
                  </span>
                </div>

                {/* Radar Sweep Circle */}
                <div className="flex items-center justify-center py-2">
                  <div className="relative w-36 h-36 rounded-full border border-[#00f0ff]/20 bg-black/40 flex items-center justify-center overflow-hidden">
                    {/* Rotating sweep line */}
                    <div className="absolute inset-0 rounded-full animate-radar-sweep pointer-events-none" style={{
                      background: 'conic-gradient(from 0deg, rgba(0, 240, 255, 0.15) 0deg, rgba(0, 240, 255, 0) 90deg, transparent 360deg)'
                    }} />
                    {/* Concentric rings */}
                    <div className="absolute w-28 h-28 rounded-full border border-[#00f0ff]/5" />
                    <div className="absolute w-20 h-20 rounded-full border border-[#00f0ff]/5" />
                    <div className="absolute w-10 h-10 rounded-full border border-[#00f0ff]/5" />
                    
                    {/* Crosshairs */}
                    <div className="absolute top-0 bottom-0 left-1/2 w-[0.5px] bg-[#00f0ff]/5 -translate-x-1/2" />
                    <div className="absolute left-0 right-0 top-1/2 h-[0.5px] bg-[#00f0ff]/5 -translate-y-1/2" />
                    
                    {/* Radar Blip Dots */}
                    <div className="absolute w-1.5 h-1.5 rounded-full bg-[#00f0ff] shadow-[0_0_6px_#00f0ff] animate-pulse" style={{ top: '30%', left: '40%' }} />
                    <div className="absolute w-1.5 h-1.5 rounded-full bg-[#00f0ff] shadow-[0_0_6px_#00f0ff] animate-pulse" style={{ top: '52%', left: '64%' }} />
                    <div className="absolute w-1.5 h-1.5 rounded-full bg-[#00f0ff] shadow-[0_0_6px_#00f0ff] animate-pulse" style={{ top: '65%', left: '25%' }} />
                    
                    <Bluetooth size={20} className="text-[#00f0ff] opacity-40 z-10" />
                  </div>
                </div>

                {/* Discovered Device List */}
                <div className="flex flex-col gap-2.5">
                  {mockDevicesList.map((mock) => {
                    const isNeonStrip = mock.name === 'NEON-STRIP-01';
                    return (
                      <div 
                        key={mock.id}
                        className="flex items-center justify-between bg-black/40 border border-white/5 px-3.5 py-2.5 rounded-xl hover:border-purple-500/20 transition-all"
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-extrabold text-white">{mock.name}</span>
                          <span className="text-[9px] text-zinc-500 font-mono mt-0.5 font-bold">
                            {mock.rssi ? `${mock.rssi} dBm` : '-50 dBm'} • {mock.mac}
                          </span>
                        </div>
                        <button
                          onClick={() => handleConnectMock(mock)}
                          disabled={isConnecting}
                          className={`px-3 py-1.5 rounded-lg text-[9px] font-extrabold transition-all tracking-wider uppercase cursor-pointer ${
                            isNeonStrip 
                            ? 'bg-[#8a46ff]/15 border border-[#8a46ff]/45 text-[#8a46ff] shadow-[0_0_10px_rgba(138,70,255,0.15)] hover:bg-[#8a46ff]/25'
                            : 'bg-zinc-800/40 border border-zinc-700/30 text-zinc-500 hover:text-zinc-400'
                          }`}
                        >
                          Pair
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* CARD 2: WIFI / IP SETUP */}
              <div className="cyber-card p-5 rounded-2xl flex flex-col gap-4" style={{ borderColor: 'rgba(138, 70, 255, 0.15)' }}>
                <div className="border-b border-white/5 pb-2">
                  <span className="text-xs font-bold text-[#ff4181] uppercase font-mono tracking-wider flex items-center gap-1.5">
                    ◆ WIFI / IP SETUP
                  </span>
                </div>

                <form onSubmit={(e) => {
                  e.preventDefault();
                  handleConnectWifi(customWifiName, customWifiIp);
                }} className="flex flex-col gap-3.5">
                  
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold font-mono uppercase tracking-wide">IP Address</label>
                    <input
                      type="text"
                      required
                      placeholder="192.168.1.42"
                      value={customWifiIp}
                      onChange={(e) => setCustomWifiIp(e.target.value)}
                      className="bg-black/60 border border-white/5 rounded-xl px-3.5 py-3 text-xs text-white focus:outline-none focus:border-[#8a46ff] transition-all font-semibold font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold font-mono uppercase tracking-wide">Port</label>
                    <input
                      type="text"
                      required
                      placeholder="8888"
                      value={customWifiPort}
                      onChange={(e) => setCustomWifiPort(e.target.value)}
                      className="bg-black/60 border border-white/5 rounded-xl px-3.5 py-3 text-xs text-white focus:outline-none focus:border-[#8a46ff] transition-all font-semibold font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="w-full py-3 mt-2 neon-btn-pink-purple rounded-xl text-xs font-extrabold uppercase tracking-widest cursor-pointer disabled:opacity-40"
                  >
                    {isConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                </form>
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
};
