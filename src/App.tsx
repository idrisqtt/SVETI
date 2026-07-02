import { useState, useEffect, useRef } from 'react';
import { 
  Layers, 
  Sparkles,
  Trash2, 
  Eye, 
  EyeOff, 
  Plus, 
  ArrowUp, 
  ArrowDown, 
  Settings, 
  Bluetooth,
  LayoutDashboard,
  Globe,
  ChevronLeft,
  SlidersHorizontal,
  Code,
  User,
  Play
} from 'lucide-react';
import type { DeviceConfig, Segment, Layer, Preset } from './types/led';
import { Visualizer } from './components/Visualizer';
import { DeviceConfigurator } from './components/DeviceConfigurator';
import { LayerEditor } from './components/LayerEditor';
import { SocialHub } from './components/SocialHub';
import { ExportModal } from './components/ExportModal';
import { useTranslation } from './utils/translations';
import type { Language } from './utils/translations';
import { 
  subscribeAuthState, 
  signUpUser, 
  logInUser, 
  logInGuest, 
  logInWithGoogle,
  signOutUser, 
  updateUserProfile 
} from './utils/authService';
import type { UserProfile } from './utils/authService';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './utils/firebase';
import { BleControlCenter } from './components/BleControlCenter';
import { MockBleDevice, WebBleDevice } from './utils/ble/bleDevice';
import type { BleDevice } from './utils/ble/bleDevice';
import { identifyProtocol } from './utils/ble/protocols';
import type { LedProtocol } from './utils/ble/protocols';

// Default LED preset workspace setup
const DEFAULT_GEOMETRY: DeviceConfig = {
  type: 'strip',
  length: 60,
  width: 16,
  height: 16,
  matrixLayout: 'serpentine',
  ringCount: 24,
};

const DEFAULT_LAYERS: Layer[] = [
  {
    id: 'layer-base',
    name: 'Midnight Deep Blue',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    effectType: 'solid',
    segmentId: 'all',
    params: {
      solid: { color: '#090d16' }
    }
  },
  {
    id: 'layer-aurora',
    name: 'Aurora Borealis Wave',
    visible: true,
    opacity: 0.85,
    blendMode: 'screen',
    effectType: 'gradient',
    segmentId: 'all',
    params: {
      gradient: {
        stops: [
          { offset: 0, color: '#ec4899' },
          { offset: 0.4, color: '#8b5cf6' },
          { offset: 0.8, color: '#06b6d4' },
          { offset: 1, color: '#10b981' }
        ],
        speed: 0.35,
        frequency: 1.2,
        direction: 45
      }
    }
  },
  {
    id: 'layer-chase',
    name: 'Meteor Chase Sparkles',
    visible: true,
    opacity: 0.6,
    blendMode: 'add',
    effectType: 'chase',
    segmentId: 'all',
    params: {
      chase: {
        color: '#ffffff',
        bgColor: '#000000',
        speed: 0.2,
        size: 2,
        spacing: 15
      }
    }
  }
];

type ScreenType = 'dashboard' | 'workspace' | 'ble' | 'cloud' | 'layer-detail' | 'layout-settings' | 'profile';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('ble');

  // Firebase Auth State
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);

  // Auth Form states
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('avatar-1');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Profile Edit states
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('avatar-1');

  useEffect(() => {
    const unsubscribe = subscribeAuthState((user) => {
      setCurrentUser(user);
      if (user) {
        setProfileDisplayName(user.displayName);
        setProfileAvatar(user.avatarUrl);
      }
    });
    return unsubscribe;
  }, []);

  // Real-time synchronization of presets library from Cloud Firestore
  useEffect(() => {
    if (!currentUser) {
      setUserPresets([]);
      return;
    }
    const q = query(collection(db, 'presets'), where('userId', '==', currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const presets: Preset[] = [];
      snapshot.forEach((doc) => {
        presets.push(doc.data() as Preset);
      });
      setUserPresets(presets);
    }, (error) => {
      console.warn("Firestore snapshot error, using local fallback:", error);
    });
    return unsubscribe;
  }, [currentUser]);
  
  // Persistent language state
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('sveti_language');
    return (saved === 'ru' || saved === 'en') ? saved : 'en';
  });

  const t = useTranslation(language);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('sveti_language', lang);
  };

  // BLE Device State
  const [activeDevice, setActiveDevice] = useState<BleDevice | null>(null);
  const [activeProtocol, setActiveProtocol] = useState<LedProtocol | null>(null);
  const lastWriteTimeRef = useRef<number>(0);

  const handleConnectDevice = async (device: BleDevice) => {
    await device.connect();
    setActiveDevice(device);
    const protocol = identifyProtocol(device, () => {});
    setActiveProtocol(protocol);

    localStorage.setItem('sveti_last_ble_device', JSON.stringify({
      id: device.id,
      name: device.name,
      isMock: device instanceof MockBleDevice,
      mac: device.mac,
      serviceUuids: device.serviceUuids
    }));

    setCurrentScreen('dashboard');
  };

  const handleDisconnectDevice = async () => {
    if (activeDevice) {
      await activeDevice.disconnect();
    }
    setActiveDevice(null);
    setActiveProtocol(null);
    localStorage.removeItem('sveti_last_ble_device');
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (isSigningUp) {
        if (!authDisplayName.trim()) throw new Error('Please enter a display name');
        await signUpUser(authEmail, authPassword, authDisplayName, selectedAvatar);
      } else {
        await logInUser(authEmail, authPassword);
      }
      // Reset forms
      setAuthEmail('');
      setAuthPassword('');
      setAuthDisplayName('');
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await logInGuest();
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await logInWithGoogle();
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileDisplayName.trim()) {
      alert("Display name cannot be empty");
      return;
    }
    try {
      await updateUserProfile(profileDisplayName, profileAvatar);
      alert("Profile updated successfully!");
    } catch (err: any) {
      alert(`Error updating profile: ${err.message}`);
    }
  };

  // Handle native disconnect events from browser GATT wrapper
  useEffect(() => {
    const handleBleDisconnect = (e: any) => {
      if (activeDevice && activeDevice.id === e.detail.deviceId) {
        handleDisconnectDevice();
      }
    };
    window.addEventListener('sveti_ble_disconnected', handleBleDisconnect);
    return () => window.removeEventListener('sveti_ble_disconnected', handleBleDisconnect);
  }, [activeDevice]);

  // Lock out navigation when disconnected (onboarding connection first)
  useEffect(() => {
    if (!currentUser) return;
    
    if (!activeDevice) {
      setCurrentScreen('ble');
    }
  }, [activeDevice, currentUser]);

  // Auto-connect BLE
  useEffect(() => {
    const savedStr = localStorage.getItem('sveti_last_ble_device');
    if (savedStr) {
      try {
        const saved = JSON.parse(savedStr);
        let device: BleDevice;
        if (saved.isMock) {
          device = new MockBleDevice(saved.id, saved.name, saved.serviceUuids || [], saved.mac);
        } else {
          const nav = navigator as any;
          if (nav.bluetooth && nav.bluetooth.getDevices) {
            nav.bluetooth.getDevices().then((devices: any[]) => {
              const match = devices.find((d: any) => d.id === saved.id);
              if (match) {
                const webDev = new WebBleDevice(match);
                handleConnectDevice(webDev).catch(console.error);
              }
            });
          }
          return;
        }
        handleConnectDevice(device).catch(console.error);
      } catch (e) {
        console.error('Failed auto-reconnecting', e);
      }
    }
  }, []);

  // Workspace States
  const [presetTitle, setPresetTitle] = useState('Nebula Aurora Dream');
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig>(DEFAULT_GEOMETRY);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [layers, setLayers] = useState<Layer[]>(DEFAULT_LAYERS);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>('layer-aurora');

  // Playback / Global states
  const [globalBrightness, setGlobalBrightness] = useState(100);
  const [globalSpeed, setGlobalSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);

  // App Glow state (dynamically updated from Visualizer canvas tick)
  const [glowColor, setGlowColor] = useState('rgba(139, 92, 246, 0.15)');

  // Modal open
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Local saved presets library states
  const [userPresets, setUserPresets] = useState<Preset[]>(() => {
    const saved = localStorage.getItem('sveti_user_presets');
    return saved ? JSON.parse(saved) : [];
  });
  const [isSavePresetOpen, setIsSavePresetOpen] = useState(false);
  const [savePresetTitle, setSavePresetTitle] = useState('');

  const handleSavePreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!savePresetTitle.trim()) return;

    const newPresetId = 'user-' + Math.random().toString(36).substring(2, 9);
    const newPreset: Preset = {
      id: newPresetId,
      userId: currentUser?.uid || 'anonymous',
      title: savePresetTitle,
      description: `Custom preset configured on ${deviceConfig.type.toUpperCase()}.`,
      author: currentUser?.displayName || 'You',
      authorAvatar: currentUser?.avatarUrl || '',
      likes: 0,
      likedByUser: false,
      forks: 0,
      comments: [],
      tags: ['saved', deviceConfig.type],
      createdAt: new Date().toLocaleDateString(),
      deviceConfig,
      segments,
      layers
    } as any;

    if (currentUser) {
      setDoc(doc(db, 'presets', newPresetId), newPreset as any).catch(err => {
        console.error("Failed to save preset to Firestore:", err);
      });
    } else {
      const updated = [newPreset, ...userPresets];
      setUserPresets(updated);
      localStorage.setItem('sveti_user_presets', JSON.stringify(updated));
    }
    
    setIsSavePresetOpen(false);
    setSavePresetTitle('');
  };

  const handleDeleteUserPreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentUser) {
      deleteDoc(doc(db, 'presets', id)).catch(err => {
        console.error("Failed to delete preset from Firestore:", err);
      });
    } else {
      const updated = userPresets.filter(p => p.id !== id);
      setUserPresets(updated);
      localStorage.setItem('sveti_user_presets', JSON.stringify(updated));
    }
  };

  // Handle Layer actions
  const addLayer = () => {
    const newLayer: Layer = {
      id: Math.random().toString(36).substring(2, 9),
      name: `Animation Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effectType: 'solid',
      segmentId: 'all',
      params: {
        solid: { color: '#8b5cf6' }
      }
    };
    setLayers([newLayer, ...layers]);
    setSelectedLayerId(newLayer.id);
    setCurrentScreen('layer-detail'); // instantly push to layer detail edit screen
  };

  const deleteLayer = (id: string) => {
    const updated = layers.filter(l => l.id !== id);
    setLayers(updated);
    if (selectedLayerId === id) {
      setSelectedLayerId(updated[0]?.id || null);
    }
  };

  const toggleLayerVisibility = (id: string) => {
    setLayers(layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  };

  const moveLayer = (index: number, direction: 'up' | 'down') => {
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= layers.length) return;

    const updated = [...layers];
    const temp = updated[index];
    updated[index] = updated[nextIndex];
    updated[nextIndex] = temp;
    setLayers(updated);
  };

  const updateSelectedLayer = (updatedLayer: Layer) => {
    setLayers(layers.map(l => l.id === updatedLayer.id ? updatedLayer : l));
  };

  // Fork preset from community
  const handleForkPreset = (preset: Preset) => {
    setPresetTitle(preset.title + ' (Fork)');
    setDeviceConfig(preset.deviceConfig);
    setSegments(preset.segments);
    setLayers(preset.layers);
    setSelectedLayerId(preset.layers[0]?.id || null);
    setCurrentScreen('workspace'); // redirect to editor workspace
  };

  // Quick Preset Templates loaders
  // Quick Preset Templates loaders (Device specific)
  const loadTemplate = (type: string) => {
    if (type === 'cyberpunk') {
      setPresetTitle('Cyber City Neon');
      setDeviceConfig({ ...deviceConfig, type: 'strip', length: 60 });
      setLayers([
        {
          id: 'bg',
          name: 'Cyber Pink Base',
          visible: true,
          opacity: 0.9,
          blendMode: 'normal',
          effectType: 'solid',
          segmentId: 'all',
          params: { solid: { color: '#db2777' } }
        },
        {
          id: 'wave',
          name: 'Cyan Wave overlay',
          visible: true,
          opacity: 0.8,
          blendMode: 'difference',
          effectType: 'gradient',
          segmentId: 'all',
          params: {
            gradient: {
              stops: [
                { offset: 0, color: '#06b6d4' },
                { offset: 0.5, color: '#000000' },
                { offset: 1, color: '#06b6d4' }
              ],
              speed: 0.6,
              frequency: 2,
              direction: 0
            }
          }
        }
      ]);
      setSelectedLayerId('wave');
    } else if (type === 'rainbow-wave') {
      setPresetTitle('Rainbow Cycle Wave');
      setDeviceConfig({ ...deviceConfig, type: 'strip', length: 60 });
      setLayers([
        {
          id: 'rb-gradient',
          name: 'Rainbow Gradient',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          effectType: 'gradient',
          segmentId: 'all',
          params: {
            gradient: {
              stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 0.2, color: '#ffff00' },
                { offset: 0.4, color: '#00ff00' },
                { offset: 0.6, color: '#00ffff' },
                { offset: 0.8, color: '#0000ff' },
                { offset: 1, color: '#ff0000' }
              ],
              speed: 0.35,
              frequency: 1,
              direction: 0
            }
          }
        }
      ]);
      setSelectedLayerId('rb-gradient');
    } else if (type === 'fire-strip') {
      setPresetTitle('Flickering Embers');
      setDeviceConfig({ ...deviceConfig, type: 'strip', length: 60 });
      setLayers([
        {
          id: 'embers-noise',
          name: 'Embers Noise',
          visible: true,
          opacity: 0.95,
          blendMode: 'normal',
          effectType: 'noise',
          segmentId: 'all',
          params: {
            noise: {
              scale: 2.5,
              speed: 0.25,
              palette: 'fire',
              colorStart: '#000000',
              colorEnd: '#000000'
            }
          }
        }
      ]);
      setSelectedLayerId('embers-noise');
    } else if (type === 'strobe-chase') {
      setPresetTitle('Strobe Wave Beam');
      setDeviceConfig({ ...deviceConfig, type: 'strip', length: 60 });
      setLayers([
        {
          id: 'bg-solid',
          name: 'Midnight Blue Base',
          visible: true,
          opacity: 0.8,
          blendMode: 'normal',
          effectType: 'solid',
          segmentId: 'all',
          params: { solid: { color: '#0f172a' } }
        },
        {
          id: 'chase-beam',
          name: 'Cyan Strobe Beam',
          visible: true,
          opacity: 0.9,
          blendMode: 'add',
          effectType: 'chase',
          segmentId: 'all',
          params: {
            chase: {
              color: '#06b6d4',
              bgColor: '#000000',
              speed: 0.6,
              size: 5,
              spacing: 15
            }
          }
        }
      ]);
      setSelectedLayerId('chase-beam');
    } else if (type === 'matrix-rain') {
      setPresetTitle('Console Code Matrix');
      setDeviceConfig({ ...deviceConfig, type: 'matrix', width: 16, height: 16 });
      setLayers([
        {
          id: 'matrix-falling',
          name: 'Falling Code Rain',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          effectType: 'script',
          segmentId: 'all',
          params: {
            script: {
              code: `// Falling binary codes\nfloat col = x;\nfloat row = y;\nfloat fall = fract(t * 0.45 + col * 0.17);\nfloat glow = 1.0 - fract((row / h) + fall);\nif (glow > 0.85) {\n  r = 180; g = 255; b = 180;\n} else if (glow > 0.45) {\n  r = 0; g = 220; b = 0;\n} else {\n  r = 0; g = 0; b = 0;\n}`
            }
          }
        }
      ]);
      setSelectedLayerId('matrix-falling');
    } else if (type === 'matrix-plasma') {
      setPresetTitle('Nebula Plasma Wave');
      setDeviceConfig({ ...deviceConfig, type: 'matrix', width: 16, height: 16 });
      setLayers([
        {
          id: 'plasma-noise',
          name: 'Ocean Plasma',
          visible: true,
          opacity: 0.9,
          blendMode: 'normal',
          effectType: 'noise',
          segmentId: 'all',
          params: {
            noise: {
              scale: 1.8,
              speed: 0.3,
              palette: 'ocean',
              colorStart: '#000000',
              colorEnd: '#000000'
            }
          }
        }
      ]);
      setSelectedLayerId('plasma-noise');
    } else if (type === 'matrix-fire') {
      setPresetTitle('2D Fireplace Hearth');
      setDeviceConfig({ ...deviceConfig, type: 'matrix', width: 16, height: 16 });
      setLayers([
        {
          id: 'hearth-fire',
          name: 'Flames Rising',
          visible: true,
          opacity: 0.95,
          blendMode: 'normal',
          effectType: 'noise',
          segmentId: 'all',
          params: {
            noise: {
              scale: 3.0,
              speed: 0.4,
              palette: 'fire',
              colorStart: '#000000',
              colorEnd: '#000000'
            }
          }
        }
      ]);
      setSelectedLayerId('hearth-fire');
    } else if (type === 'matrix-spiral') {
      setPresetTitle('Hypno Vortex Spiral');
      setDeviceConfig({ ...deviceConfig, type: 'matrix', width: 16, height: 16 });
      setLayers([
        {
          id: 'spiral-math',
          name: 'Vortex Math Script',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          effectType: 'script',
          segmentId: 'all',
          params: {
            script: {
              code: `// Spinning spiral math\nfloat dx = x - w/2.0;\nfloat dy = y - h/2.0;\nfloat dist = sqrt(dx*dx + dy*dy);\nfloat angle = atan2(dy, dx);\nfloat spiral = sin(dist * 0.8 - angle * 2.0 + t * 4.0);\nr = int(127.0 + 127.0 * sin(spiral + t));\ng = int(127.0 + 127.0 * sin(spiral + t + 2.0));\nb = int(255.0 * (1.0 - dist/(w*0.7)));`
            }
          }
        }
      ]);
      setSelectedLayerId('spiral-math');
    } else if (type === 'ring-radar') {
      setPresetTitle('Radar Circle Beacon');
      setDeviceConfig({ ...deviceConfig, type: 'ring', ringCount: 32 });
      setLayers([
        {
          id: 'radar-sweep',
          name: 'Radar Sweep',
          visible: true,
          opacity: 0.95,
          blendMode: 'normal',
          effectType: 'chase',
          segmentId: 'all',
          params: {
            chase: {
              color: '#10b981',
              bgColor: '#020617',
              speed: 0.4,
              size: 6,
              spacing: 16
            }
          }
        }
      ]);
      setSelectedLayerId('radar-sweep');
    } else if (type === 'ring-aurora') {
      setPresetTitle('Aura Glow Ring');
      setDeviceConfig({ ...deviceConfig, type: 'ring', ringCount: 32 });
      setLayers([
        {
          id: 'aurora-grad',
          name: 'Forest Aurora',
          visible: true,
          opacity: 0.95,
          blendMode: 'normal',
          effectType: 'gradient',
          segmentId: 'all',
          params: {
            gradient: {
              stops: [
                { offset: 0, color: '#10b981' },
                { offset: 0.5, color: '#6366f1' },
                { offset: 1, color: '#10b981' }
              ],
              speed: 0.3,
              frequency: 1.5,
              direction: 0
            }
          }
        }
      ]);
      setSelectedLayerId('aurora-grad');
    } else if (type === 'ring-spinner') {
      setPresetTitle('Chasing Color Spinner');
      setDeviceConfig({ ...deviceConfig, type: 'ring', ringCount: 32 });
      setLayers([
        {
          id: 'spinner-wheel',
          name: 'Rainbow Spinner',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          effectType: 'gradient',
          segmentId: 'all',
          params: {
            gradient: {
              stops: [
                { offset: 0, color: '#a855f7' },
                { offset: 0.5, color: '#3b82f6' },
                { offset: 1, color: '#a855f7' }
              ],
              speed: 0.7,
              frequency: 2.0,
              direction: 0
            }
          }
        }
      ]);
      setSelectedLayerId('spinner-wheel');
    } else if (type === 'ring-pulse') {
      setPresetTitle('Pulsing Audio Ring');
      setDeviceConfig({ ...deviceConfig, type: 'ring', ringCount: 32 });
      setLayers([
        {
          id: 'pulse-solid',
          name: 'Warm Red Pulse',
          visible: true,
          opacity: 0.9,
          blendMode: 'normal',
          effectType: 'solid',
          segmentId: 'all',
          params: { solid: { color: '#ef4444' } }
        },
        {
          id: 'audio-mod',
          name: 'Beat Modifier',
          visible: true,
          opacity: 0.85,
          blendMode: 'multiply',
          effectType: 'audio',
          segmentId: 'all',
          params: {}
        }
      ]);
      setSelectedLayerId('audio-mod');
    }
  };

  const handleColorsUpdate = (colors: [number, number, number][]) => {
    if (colors.length === 0) return;
    const s1 = colors[Math.floor(colors.length * 0.2)] || [0,0,0];
    const s2 = colors[Math.floor(colors.length * 0.5)] || [0,0,0];
    const s3 = colors[Math.floor(colors.length * 0.8)] || [0,0,0];

    const r = Math.round((s1[0] + s2[0] + s3[0]) / 3);
    const g = Math.round((s1[1] + s2[1] + s3[1]) / 3);
    const b = Math.round((s1[2] + s2[2] + s3[2]) / 3);

    setGlowColor(`rgba(${r}, ${g}, ${b}, 0.15)`);

    // Stream visualizer color updates to the connected device (throttled to 100ms)
    if (activeProtocol && currentScreen !== 'ble') {
      const now = Date.now();
      if (now - lastWriteTimeRef.current > 100) {
        lastWriteTimeRef.current = now;
        const targetPixel = colors[0] || [0, 0, 0];
        activeProtocol.setRGB(targetPixel[0], targetPixel[1], targetPixel[2]).catch(() => {});
      }
    }
  };

  const selectedLayer = layers.find(l => l.id === selectedLayerId) || null;

  return (
    <div className="min-h-screen bg-[#020204] flex items-center justify-center p-0 sm:p-4 md:p-6 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.06)_0%,transparent_50%)] overflow-hidden">
      
      {/* Background Ambient Glow */}
      <div
        className="absolute inset-0 bg-[#030307] transition-all duration-1000 pointer-events-none -z-20"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 12%, ${glowColor} 0%, transparent 60%)`
        }}
      />
      <div className="ambient-background-glow animate-pulse-glow" />

      {/* Cyberdeck Phone Frame Shell - Expand to max-w-4xl on desktop */}
      <div className="w-full max-w-md md:max-w-4xl h-screen md:h-[820px] md:max-h-[92vh] bg-[#07070d]/90 sm:border sm:border-zinc-800/80 sm:rounded-[24px] shadow-2xl relative overflow-hidden flex flex-col sm:shadow-[0_0_50px_rgba(139,92,246,0.15)] border-x border-white/5">
        
        {/* iOS Dynamic Island notch frame - Hide on desktop */}
        <div className="hidden sm:flex md:hidden absolute top-3 left-1/2 -translate-x-1/2 w-28 h-5 bg-black rounded-full z-50 items-center justify-center border border-zinc-800/30">
          <div className="w-2 h-2 bg-zinc-900 rounded-full mr-2 border border-zinc-800/40" />
          <div className="w-12 h-1 bg-[#1e1e24] rounded-full" />
        </div>

        {/* Home indicator bar at bottom - Hide on desktop */}
        <div className="hidden sm:block md:hidden absolute bottom-1.5 left-1/2 -translate-x-1/2 w-28 h-1 bg-zinc-800/70 rounded-full z-50 pointer-events-none" />

        {/* Header Bar */}
        <header className="px-5 pt-4 pb-3 flex justify-between items-center bg-[#09090f]/90 border-b border-white/5 backdrop-blur-md sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-2">
            {/* Show Back Button on detailed views, otherwise show the sparkles logo and text branding */}
            {(currentScreen === 'layer-detail' || currentScreen === 'layout-settings' || (currentScreen === 'ble' && activeDevice)) ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setCurrentScreen(currentScreen === 'layer-detail' ? 'workspace' : 'dashboard')}
                  className="p-1 -ml-1 text-zinc-400 hover:text-white transition-colors mr-1"
                >
                  <ChevronLeft size={20} />
                </button>
                {currentScreen === 'layer-detail' ? (
                  <div className="flex flex-col select-none">
                    <span className="text-[9px] text-zinc-500 font-mono tracking-wider leading-none mb-0.5">// editing</span>
                    <span className="font-extrabold text-sm text-white uppercase tracking-wider leading-none">
                      {selectedLayer?.name || 'PLASMA LAYER'}
                    </span>
                  </div>
                ) : (
                  <h1 className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
                    {currentScreen === 'layout-settings' ? t('mobileSetup') : 'BLE Settings'}
                  </h1>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-[0_0_10px_var(--primary-glow)]">
                  <Sparkles size={12} className="text-white" />
                </div>
                <h1 className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
                  SVETI
                </h1>
                <span className="text-[9px] bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded text-primary font-medium tracking-wide">
                  {t('versionPro')}
                </span>
                {activeDevice && (
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse ml-1" />
                )}
              </div>
            )}
          </div>

          {/* Language selector & top Actions */}
          <div className="flex items-center gap-3">
            <div className="flex bg-black/40 border border-white/5 rounded-lg p-0.5 text-[10px] font-bold">
              <button
                onClick={() => handleLanguageChange('en')}
                className={`px-2 py-0.5 rounded ${language === 'en' ? 'bg-primary text-white shadow-sm' : 'text-zinc-400'}`}
              >
                EN
              </button>
              <button
                onClick={() => handleLanguageChange('ru')}
                className={`px-2 py-0.5 rounded ${language === 'ru' ? 'bg-primary text-white shadow-sm' : 'text-zinc-400'}`}
              >
                RU
              </button>
            </div>
          </div>
        </header>

        {/* Main Native Screen Content Area */}
        <main className="flex-1 overflow-y-auto p-4 pb-20 scrollbar-none">
          
          {/* USER AUTH SCREEN (FIRST STEP BEFORE EVERYTHING ELSE) */}
          {!currentUser ? (
            <div className="flex flex-col gap-6 p-4 animate-fade-in max-w-sm mx-auto justify-center min-h-[75vh]">
              {/* Header / Intro */}
              <div className="text-center flex flex-col items-center gap-1.5 mt-2">
                <div className="w-20 h-20 rounded-[22px] bg-zinc-950/80 border border-purple-500/20 flex items-center justify-center shadow-[0_0_30px_rgba(138,70,255,0.15)] mb-3">
                  <div className="w-8 h-8 rounded-full border-4 border-[#8a46ff] shadow-[0_0_15px_rgba(138,70,255,0.8)]" />
                </div>
                <h2 className="font-extrabold text-2xl text-white tracking-tight">
                  Welcome back
                </h2>
                <p className="text-xs font-mono text-zinc-500 tracking-wide">
                  // authenticate to continue
                </p>
              </div>

              {/* Error Alert */}
              {authError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] p-3 rounded-xl leading-normal font-medium animate-fade-in">
                  ⚠️ {authError}
                </div>
              )}

              {/* Login / Registration Form */}
              <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4">
                {isSigningUp && (
                  <div className="flex flex-col gap-1.5 animate-fade-in">
                    <label className="text-[10px] text-zinc-400 font-bold uppercase font-mono tracking-wider">Display Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Operator One"
                      value={authDisplayName}
                      onChange={(e) => setAuthDisplayName(e.target.value)}
                      className="bg-black/60 border border-white/5 rounded-xl px-3.5 py-3 text-xs text-white focus:outline-none focus:border-[#8a46ff] focus:shadow-[0_0_10px_rgba(138,70,255,0.15)] transition-all font-semibold"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-zinc-400 font-bold uppercase font-mono tracking-wider">Email</label>
                  <input
                    type="email"
                    required
                    placeholder="operator@deck.io"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="bg-black/60 border border-white/5 rounded-xl px-3.5 py-3 text-xs text-white focus:outline-none focus:border-[#8a46ff] focus:shadow-[0_0_10px_rgba(138,70,255,0.15)] transition-all font-semibold font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-zinc-400 font-bold uppercase font-mono tracking-wider">Password</label>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full bg-black/60 border border-white/5 rounded-xl px-3.5 py-3 text-xs text-white focus:outline-none focus:border-[#8a46ff] focus:shadow-[0_0_10px_rgba(138,70,255,0.15)] transition-all font-semibold font-mono tracking-widest pr-14"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-accent hover:text-white uppercase tracking-wider font-mono cursor-pointer"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {isSigningUp && (
                  <div className="flex flex-col gap-2 border-t border-white/5 pt-2.5 animate-fade-in">
                    <label className="text-[10px] text-zinc-400 font-bold uppercase font-mono tracking-wider">Choose Avatar Badge</label>
                    <div className="flex gap-2 justify-between">
                      {[
                        { id: 'avatar-1', bg: 'bg-pink-500', name: 'Cyber Pink' },
                        { id: 'avatar-2', bg: 'bg-emerald-500', name: 'Neon Mint' },
                        { id: 'avatar-3', bg: 'bg-amber-500', name: 'Sunset Glow' },
                        { id: 'avatar-4', bg: 'bg-indigo-500', name: 'Electric Indigo' }
                      ].map(av => (
                        <button
                          key={av.id}
                          type="button"
                          onClick={() => setSelectedAvatar(av.id)}
                          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                            selectedAvatar === av.id 
                            ? 'border-2 border-white scale-110 shadow-[0_0_12px_rgba(255,255,255,0.25)]' 
                            : 'border border-white/10 opacity-60 hover:opacity-100'
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-full ${av.bg} shadow-inner`} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 mt-2 neon-btn-pink-purple rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  {authLoading ? 'Processing...' : isSigningUp ? 'Register Account' : 'Sign In →'}
                </button>
              </form>

              {/* Guest & Google login */}
              <div className="flex flex-col gap-3.5 mt-1">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={authLoading}
                  className="w-full py-3 bg-black/60 hover:bg-zinc-900 border border-white/5 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-40"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  Continue with Google
                </button>

                <div className="flex flex-col items-center gap-2 border-t border-white/5 pt-3">
                  <button
                    type="button"
                    onClick={handleGuestLogin}
                    disabled={authLoading}
                    className="text-xs text-accent hover:text-white transition-colors font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    Enter as guest →
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSigningUp(!isSigningUp);
                      setAuthError(null);
                    }}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors font-medium mt-1"
                  >
                    {isSigningUp ? 'Already registered? Sign In' : 'Need an account? Register'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* SCREEN 1: DASHBOARD */}
              {currentScreen === 'dashboard' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in items-start">
              
              {/* Column 1: Connection & Active Preset Card */}
              <div className="flex flex-col gap-4">
                {/* Active Connection Widget */}
                <div 
                  onClick={() => setCurrentScreen('ble')}
                  className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex items-center justify-between cursor-pointer hover:border-purple-500/30 transition-all shadow-inner group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${activeDevice ? 'bg-green-500/10 text-green-400 border border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.15)]' : 'bg-purple-500/10 text-primary border border-purple-500/20'} transition-all`}>
                      <Bluetooth size={18} className={activeDevice ? 'animate-pulse' : ''} />
                    </div>
                    <div>
                      <h3 className="text-xs text-zinc-400 font-medium">{t('bleController')}</h3>
                      <p className="text-sm font-semibold text-white">
                        {activeDevice ? activeDevice.name : t('bleDisconnected')}
                      </p>
                    </div>
                  </div>
                  {activeDevice ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDisconnectDevice();
                      }}
                      className="px-2.5 py-1 text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 rounded-lg transition-all z-10"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors font-medium">
                      {t('bleConnect')} →
                    </span>
                  )}
                </div>

                {/* Preset Quick View Player Card */}
                <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/5 backdrop-blur-md flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Active Preset</span>
                      <input
                        type="text"
                        value={presetTitle}
                        onChange={(e) => setPresetTitle(e.target.value)}
                        className="text-base font-bold text-white bg-transparent border-none p-0 focus:outline-none focus:ring-0 w-full"
                      />
                    </div>
                    <button 
                      onClick={() => setIsExportOpen(true)}
                      className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 text-primary flex items-center justify-center hover:bg-purple-500/20 transition-all shrink-0"
                      title={t('exportArduino')}
                    >
                      <Code size={14} />
                    </button>
                  </div>

                  {/* Minimal preview visualizer thumbnail */}
                  <div 
                    onClick={() => setCurrentScreen('workspace')}
                    className="h-16 rounded-xl bg-black/60 border border-white/5 overflow-hidden relative cursor-pointer group flex items-center justify-center"
                  >
                    <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/5 to-pink-500/5 group-hover:opacity-100 transition-opacity" />
                    <span className="text-[11px] text-zinc-500 group-hover:text-primary transition-colors font-semibold z-10 flex items-center gap-1.5">
                      <Layers size={12} /> {t('mobilePreview')}
                    </span>
                  </div>
                </div>

                {/* My Saved Presets Gallery Card */}
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex flex-col gap-3 animate-fade-in">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers size={14} className="text-primary" />
                      My Saved Presets
                    </h3>
                    <button
                      onClick={() => setIsSavePresetOpen(true)}
                      className="px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold hover:bg-primary/25 transition-all"
                    >
                      + Save Current
                    </button>
                  </div>

                  {userPresets.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-3 italic text-center">
                      No custom presets saved. Customize canvas and tap Save.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
                      {userPresets.map(p => (
                        <div
                          key={p.id}
                          onClick={() => {
                            setPresetTitle(p.title);
                            setDeviceConfig(p.deviceConfig);
                            setSegments(p.segments);
                            setLayers(p.layers);
                            setSelectedLayerId(p.layers[0]?.id || null);
                            setCurrentScreen('workspace');
                          }}
                          className="flex justify-between items-center bg-black/40 border border-white/5 px-3 py-2 rounded-xl cursor-pointer hover:border-purple-500/20 transition-all group"
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-white group-hover:text-primary transition-colors truncate">
                              {p.title}
                            </span>
                            <span className="text-[9px] text-zinc-500 uppercase tracking-wider mt-0.5">
                              {p.deviceConfig.type} • {p.layers.length} Layers
                            </span>
                          </div>
                          <button
                            onClick={(e) => handleDeleteUserPreset(p.id, e)}
                            className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                            title="Delete preset"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Column 2: Layout action, Parameters, Preset Templates */}
              <div className="flex flex-col gap-4">
                {/* Layout Configurator Quick Actions */}
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800/40 border border-white/5 text-zinc-300 flex items-center justify-center">
                      <SlidersHorizontal size={18} />
                    </div>
                    <div>
                      <h3 className="text-xs text-zinc-400 font-medium">Layout Matrix & Strips</h3>
                      <p className="text-[11px] text-zinc-500 capitalize">
                        {deviceConfig.type} • {deviceConfig.type === 'strip' ? `${deviceConfig.length} LEDs` : deviceConfig.type === 'matrix' ? `${deviceConfig.width}x${deviceConfig.height}` : `${deviceConfig.ringCount} LEDs`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setCurrentScreen('layout-settings')}
                    className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-[0_0_12px_var(--primary-glow)] transition-all"
                  >
                    {t('mobileSetup')}
                  </button>
                </div>

                {/* Global Parameters adjustments */}
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex flex-col gap-4">
                  {/* Speed Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-medium">{t('globalSpeedScale')}</span>
                      <span className="text-primary font-bold font-mono">{globalSpeed.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2.0"
                      step="0.1"
                      value={globalSpeed}
                      onChange={(e) => setGlobalSpeed(Number(e.target.value))}
                      className="w-full accent-primary bg-zinc-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Brightness Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-medium">{t('simulatorBrightness')}</span>
                      <span className="text-secondary font-bold font-mono">{globalBrightness}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={globalBrightness}
                      onChange={(e) => setGlobalBrightness(Number(e.target.value))}
                      className="w-full accent-secondary bg-zinc-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                {/* Quick Template Preset Templates Loader */}
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs text-zinc-400 font-semibold">{t('loadPresetTemplates')}</h4>
                    <span className="text-[9px] bg-primary/10 border border-primary/20 px-2 py-0.5 rounded text-primary font-mono uppercase font-bold">
                      {deviceConfig.type} mode
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    {deviceConfig.type === 'strip' && (
                      <>
                        <button
                          onClick={() => loadTemplate('cyberpunk')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-pink-500/10 hover:border-pink-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-pink-400 group-hover:text-pink-300">Cyber City</span>
                          <span className="text-[9px] text-zinc-500">Dual blend gradient</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('rainbow-wave')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-purple-500/10 hover:border-purple-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-purple-400 group-hover:text-purple-300">Rainbow Wave</span>
                          <span className="text-[9px] text-zinc-500">Rainbow color cycle</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('fire-strip')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-amber-500/10 hover:border-amber-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-amber-400 group-hover:text-amber-300">Fire Embers</span>
                          <span className="text-[9px] text-zinc-500">Warm flickering noise</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('strobe-chase')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-cyan-500/10 hover:border-cyan-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-cyan-400 group-hover:text-cyan-300">Strobe Wave</span>
                          <span className="text-[9px] text-zinc-500">Cyan tracking beams</span>
                        </button>
                      </>
                    )}

                    {deviceConfig.type === 'matrix' && (
                      <>
                        <button
                          onClick={() => loadTemplate('matrix-rain')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-green-500/10 hover:border-green-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-green-400 group-hover:text-green-300">Binary Rain</span>
                          <span className="text-[9px] text-zinc-500">Falling matrix codes</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('matrix-plasma')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-blue-500/10 hover:border-blue-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-blue-400 group-hover:text-blue-300">Ocean Plasma</span>
                          <span className="text-[9px] text-zinc-500">Water ripple noise</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('matrix-fire')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-orange-500/10 hover:border-orange-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-orange-400 group-hover:text-orange-300">2D Hearth Fire</span>
                          <span className="text-[9px] text-zinc-500">Rising flame simulation</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('matrix-spiral')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-pink-500/10 hover:border-pink-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-pink-400 group-hover:text-pink-300">Hypno Spiral</span>
                          <span className="text-[9px] text-zinc-500">Psychedelic vortex</span>
                        </button>
                      </>
                    )}

                    {deviceConfig.type === 'ring' && (
                      <>
                        <button
                          onClick={() => loadTemplate('ring-radar')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-emerald-500/10 hover:border-emerald-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-emerald-400 group-hover:text-emerald-300">Radar Beacon</span>
                          <span className="text-[9px] text-zinc-500">Circular sweep lines</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('ring-aurora')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-indigo-500/10 hover:border-indigo-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-indigo-400 group-hover:text-indigo-300">Aura Glow</span>
                          <span className="text-[9px] text-zinc-500">Indigo pulsing gradient</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('ring-spinner')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-purple-500/10 hover:border-purple-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-purple-400 group-hover:text-purple-300">RGB Spinner</span>
                          <span className="text-[9px] text-zinc-500">Rotating colors wheel</span>
                        </button>
                        <button
                          onClick={() => loadTemplate('ring-pulse')}
                          className="p-3 text-left rounded-xl bg-zinc-950/60 border border-red-500/10 hover:border-red-500/30 text-white font-medium transition-all group flex flex-col gap-1 shadow-sm"
                        >
                          <span className="text-xs font-bold text-red-400 group-hover:text-red-300">Audio Pulse</span>
                          <span className="text-[9px] text-zinc-500">Beat sync multiplier</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* SCREEN 2: WORKSPACE (LIVE PREVIEW & LAYERS STACK) */}
          {currentScreen === 'workspace' && (
            <div className="flex flex-col gap-4 animate-fade-in max-w-sm mx-auto w-full">
              {/* Scene Header with Playback Controls */}
              <div className="flex justify-between items-center mb-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">// scene</span>
                  <h1 className="font-extrabold text-xl text-white tracking-tight uppercase">
                    {presetTitle || 'UNTITLED.SCENE'}
                  </h1>
                </div>
                
                {/* Control buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  <button 
                    onClick={() => setIsPlaying(false)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all cursor-pointer ${!isPlaying ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-black/40 border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-900'}`}
                  >
                    <span className="font-mono text-xs font-extrabold">||</span>
                  </button>
                  <button 
                    onClick={() => setIsPlaying(true)}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${isPlaying ? 'neon-btn-pink-purple shadow-[0_0_15px_rgba(255,65,129,0.4)]' : 'bg-black/40 border border-white/5 text-zinc-400 hover:text-white'}`}
                  >
                    <Play size={14} className="fill-current ml-0.5 text-white" />
                  </button>
                </div>
              </div>

              {/* Main Visualizer Container */}
              <div className="relative rounded-2xl overflow-hidden border border-white/5 bg-black/60 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
                <Visualizer
                  deviceConfig={deviceConfig}
                  segments={segments}
                  layers={layers}
                  globalBrightness={globalBrightness}
                  globalSpeed={globalSpeed}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  onColorsUpdate={handleColorsUpdate}
                  t={t}
                />
                
                {/* Floating Export Action Button */}
                <button 
                  onClick={() => setIsExportOpen(true)}
                  className="absolute top-2.5 right-2.5 px-2.5 py-1.5 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-white text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 hover:bg-black/90 transition-all z-10 cursor-pointer"
                >
                  <Settings size={10} /> {t('exportArduino')}
                </button>
              </div>

              {/* Layers Section */}
              <div className="flex flex-col gap-3 mt-2">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <h3 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest font-mono">
                    Layers
                  </h3>
                  <button
                    onClick={addLayer}
                    className="w-6 h-6 rounded-lg bg-[#8a46ff]/10 border border-[#8a46ff]/35 text-[#8a46ff] flex items-center justify-center hover:bg-[#8a46ff]/20 transition-all cursor-pointer"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {/* Layer Cards Stack */}
                <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                  {layers.map((l, index) => {
                    // Generate gradient/solid background preview inline
                    let previewBackground = '#1f1f2e';
                    if (l.visible) {
                      if (l.effectType === 'solid' && l.params.solid) {
                        previewBackground = l.params.solid.color;
                      } else if (l.effectType === 'gradient' && l.params.gradient) {
                        const stops = l.params.gradient.stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ');
                        previewBackground = `linear-gradient(90deg, ${stops})`;
                      } else if (l.effectType === 'noise' && l.params.noise) {
                        previewBackground = `linear-gradient(90deg, ${l.params.noise.colorStart}, ${l.params.noise.colorEnd})`;
                      } else if (l.effectType === 'chase' && l.params.chase) {
                        previewBackground = `linear-gradient(90deg, ${l.params.chase.color}, ${l.params.chase.bgColor})`;
                      } else if (l.effectType === 'audio' && l.params.audio) {
                        previewBackground = `linear-gradient(90deg, ${l.params.audio.color}, ${l.params.audio.bgColor})`;
                      }
                    }

                    return (
                      <div
                        key={l.id}
                        onClick={() => {
                          setSelectedLayerId(l.id);
                          setCurrentScreen('layer-detail');
                        }}
                        className={`cyber-card px-4 py-3 rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                          selectedLayerId === l.id 
                          ? 'border-purple-500/30 bg-[#8a46ff]/5 shadow-[0_0_12px_rgba(138,70,255,0.1)]' 
                          : 'border-white/5 hover:border-zinc-800'
                        } ${!l.visible ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          {/* Eye Toggle Visibility */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLayerVisibility(l.id);
                            }}
                            className="text-zinc-500 hover:text-white transition-colors cursor-pointer"
                          >
                            {l.visible ? <Eye size={16} /> : <EyeOff size={16} className="text-zinc-700" />}
                          </button>

                          {/* Gradient Thumbnail */}
                          <div 
                            className="w-6 h-6 rounded-md border border-white/10 shrink-0" 
                            style={{ background: previewBackground }}
                          />

                          {/* Info */}
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-white truncate">{l.name}</span>
                            <span className="text-[9px] text-zinc-500 font-mono tracking-wider font-bold mt-0.5 uppercase">
                              {l.blendMode} • {Math.round(l.opacity * 100)}%
                            </span>
                          </div>
                        </div>

                        {/* Order & Settings controls */}
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col">
                            <button
                              onClick={() => moveLayer(index, 'up')}
                              disabled={index === 0}
                              className="p-0.5 text-zinc-500 hover:text-white disabled:opacity-20 cursor-pointer"
                            >
                              <ArrowUp size={10} />
                            </button>
                            <button
                              onClick={() => moveLayer(index, 'down')}
                              disabled={index === layers.length - 1}
                              className="p-0.5 text-zinc-500 hover:text-white disabled:opacity-20 cursor-pointer"
                            >
                              <ArrowDown size={10} />
                            </button>
                          </div>
                          
                          {layers.length > 1 && (
                            <button
                              onClick={() => deleteLayer(l.id)}
                              className="text-zinc-500 hover:text-red-400 p-1 transition-colors cursor-pointer"
                              title="Delete layer"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 3: LAYER DETAIL PARAMETERS EDITING */}
          {currentScreen === 'layer-detail' && (
            <div className="animate-fade-in">
              <LayerEditor
                layer={selectedLayer}
                segments={segments}
                onUpdateLayer={updateSelectedLayer}
                t={t}
              />
            </div>
          )}

          {/* SCREEN 4: LAYOUT CONFIG & SEGMENTS SETUP */}
          {currentScreen === 'layout-settings' && (
            <div className="animate-fade-in">
              <DeviceConfigurator
                config={deviceConfig}
                onChangeConfig={setDeviceConfig}
                segments={segments}
                onChangeSegments={setSegments}
                t={t}
              />
            </div>
          )}

          {/* SCREEN 5: BLE DEVICE SCANS */}
          {currentScreen === 'ble' && (
            <div className="animate-fade-in">
              <BleControlCenter
                t={t}
                language={language}
                activeDevice={activeDevice}
                activeProtocol={activeProtocol}
                onConnectDevice={handleConnectDevice}
                onDisconnectDevice={handleDisconnectDevice}
              />
            </div>
          )}

          {/* SCREEN 6: CLOUD PRESETS HUB */}
          {currentScreen === 'cloud' && (
            <div className="animate-fade-in">
              <SocialHub
                onForkPreset={handleForkPreset}
                activePresetData={{
                  title: presetTitle,
                  deviceConfig,
                  segments,
                  layers
                }}
                t={t}
              />
            </div>
          )}

          {/* SCREEN 7: USER PROFILE PANEL */}
          {currentScreen === 'profile' && currentUser && (
            <div className="flex flex-col gap-4 animate-fade-in max-w-sm mx-auto">
              
              {/* Profile Card Header */}
              <div className="p-5 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex flex-col items-center text-center gap-3">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center border border-white/10 ${
                  currentUser.avatarUrl === 'avatar-1' ? 'bg-pink-500' :
                  currentUser.avatarUrl === 'avatar-2' ? 'bg-emerald-500' :
                  currentUser.avatarUrl === 'avatar-3' ? 'bg-amber-500' :
                  currentUser.avatarUrl === 'avatar-4' ? 'bg-indigo-500' : 'bg-zinc-700'
                } shadow-[0_0_15px_rgba(255,255,255,0.15)]`}>
                  <div className="w-10 h-10 rounded-full bg-black/20 flex items-center justify-center font-bold text-white uppercase">
                    {profileDisplayName.substring(0, 2)}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{currentUser.displayName}</h3>
                  <span className="text-[9px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-zinc-400 font-semibold uppercase tracking-wider font-mono">
                    {currentUser.isAnonymous ? 'Guest Operator (Offline)' : 'Registered Cloud Account'}
                  </span>
                  {!currentUser.isAnonymous && currentUser.email && (
                    <p className="text-[10px] text-zinc-500 font-mono mt-1">{currentUser.email}</p>
                  )}
                </div>
              </div>

              {/* Profile Editor Settings Form */}
              <form onSubmit={handleUpdateProfile} className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-md flex flex-col gap-4">
                <span className="text-[10px] text-zinc-500 font-bold uppercase font-mono tracking-wider">Edit Operator Profile</span>
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-zinc-400 font-bold">Display Name</label>
                  <input
                    type="text"
                    required
                    value={profileDisplayName}
                    onChange={(e) => setProfileDisplayName(e.target.value)}
                    className="bg-black/60 border border-white/5 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-primary transition-all font-semibold"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[10px] text-zinc-400 font-bold">Select Badge Color</label>
                  <div className="flex gap-2 justify-between">
                    {[
                      { id: 'avatar-1', bg: 'bg-pink-500' },
                      { id: 'avatar-2', bg: 'bg-emerald-500' },
                      { id: 'avatar-3', bg: 'bg-amber-500' },
                      { id: 'avatar-4', bg: 'bg-indigo-500' }
                    ].map(av => (
                      <button
                        key={av.id}
                        type="button"
                        onClick={() => setProfileAvatar(av.id)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                          profileAvatar === av.id 
                          ? 'border-2 border-white scale-110 shadow-[0_0_12px_rgba(255,255,255,0.25)]' 
                          : 'border border-white/10 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-full ${av.bg} shadow-inner`} />
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 mt-1 bg-primary hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-[0_0_12px_var(--primary-glow)]"
                >
                  Save Profile Settings
                </button>
              </form>

              {/* Logout Button */}
              <button
                type="button"
                onClick={() => {
                  if (confirm("Are you sure you want to sign out?")) {
                    signOutUser();
                    // Go to BLE scanning page as default redirect
                    setCurrentScreen('ble');
                  }
                }}
                className="w-full py-2.5 rounded-xl border border-red-500/20 hover:bg-red-500/10 text-red-400 hover:text-red-300 text-xs font-bold transition-all"
              >
                Sign Out / Exit Operator
              </button>

            </div>
          )}

            </>
          )}

        </main>

        {/* BOTTOM NAVIGATION TAB BAR */}
        {/* Only show when connected (Bluetooth connection first) and not in detailed editors */}
        {activeDevice !== null && currentScreen !== 'layer-detail' && currentScreen !== 'layout-settings' && (
          <nav className="absolute bottom-0 left-0 right-0 h-16 bg-[#09090f]/90 border-t border-white/5 backdrop-blur-xl flex justify-around items-center px-2 z-40 shrink-0">
            {/* Dashboard Button */}
            <button
              onClick={() => setCurrentScreen('dashboard')}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 transition-all ${
                currentScreen === 'dashboard' ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <LayoutDashboard size={18} className={currentScreen === 'dashboard' ? 'shadow-neon-glow' : ''} />
              <span className="text-[9px] font-semibold tracking-wider">Home</span>
              {currentScreen === 'dashboard' && (
                <div className="w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_8px_var(--primary-glow)] -mb-1 animate-pulse" />
              )}
            </button>

            {/* Workspace Button */}
            <button
              onClick={() => setCurrentScreen('workspace')}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 transition-all ${
                currentScreen === 'workspace' ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Layers size={18} />
              <span className="text-[9px] font-semibold tracking-wider">Canvas</span>
              {currentScreen === 'workspace' && (
                <div className="w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_8px_var(--primary-glow)] -mb-1 animate-pulse" />
              )}
            </button>


            {/* Community/Cloud Button */}
            <button
              onClick={() => setCurrentScreen('cloud')}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 transition-all ${
                currentScreen === 'cloud' ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Globe size={18} />
              <span className="text-[9px] font-semibold tracking-wider">Cloud</span>
              {currentScreen === 'cloud' && (
                <div className="w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_8px_var(--primary-glow)] -mb-1 animate-pulse" />
              )}
            </button>

            {/* Profile Button */}
            <button
              onClick={() => setCurrentScreen('profile')}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 transition-all ${
                currentScreen === 'profile' ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <User size={18} />
              <span className="text-[9px] font-semibold tracking-wider">Profile</span>
              {currentScreen === 'profile' && (
                <div className="w-1.5 h-1.5 bg-primary rounded-full shadow-[0_0_8px_var(--primary-glow)] -mb-1 animate-pulse" />
              )}
            </button>
          </nav>
        )}

      </div>

      {/* Export & C++ Modal Overlay (presented as native bottom drawer) */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        presetTitle={presetTitle}
        deviceConfig={deviceConfig}
        layers={layers}
        t={t}
      />

      {/* Save Canvas Preset Slide-up Sheet */}
      {isSavePresetOpen && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end justify-center animate-fade-in">
          <div className="absolute inset-0" onClick={() => setIsSavePresetOpen(false)} />
          <form 
            onSubmit={handleSavePreset}
            className="w-full bg-[#07070c] border-t border-white/10 rounded-t-[28px] p-6 flex flex-col gap-4 relative z-10 animate-slide-up max-h-[85vh] overflow-y-auto"
          >
            <div className="w-12 h-1 bg-zinc-800 rounded-full mx-auto -mt-2 mb-2" />
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Code size={14} className="text-primary" />
                Save Current Canvas
              </h3>
              <button 
                type="button"
                onClick={() => setIsSavePresetOpen(false)}
                className="text-zinc-500 hover:text-white text-xs font-semibold"
              >
                Cancel
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-zinc-500 font-bold uppercase font-mono">Preset Title</label>
              <input
                type="text"
                required
                placeholder="e.g. My Custom Animation"
                value={savePresetTitle}
                onChange={(e) => setSavePresetTitle(e.target.value)}
                className="w-full bg-zinc-950/60 border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="bg-black/35 p-3 rounded-xl border border-white/5 text-[10px] text-zinc-500 leading-normal">
              This captures your current workspace layout parameters ({deviceConfig.type.toUpperCase()}, {layers.length} layers, and custom LED segments) and saves them to your local preset library.
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-primary hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-[0_0_15px_var(--primary-glow)]"
            >
              Save Preset
            </button>
          </form>
        </div>
      )}

    </div>
  );
}
