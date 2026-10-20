// Web MIDI wrapper for the AR Camera Studio: listens on every connected MIDI
// input and emits normalized control-change / note events so musicians can
// drive layer effects from hardware controllers.

export interface MidiMessage {
  type: 'cc' | 'noteon' | 'noteoff';
  channel: number;    // 0..15
  controller: number; // CC number (cc only)
  note: number;       // note number (note events only)
  value: number;      // normalized 0..1 (CC value or velocity)
}

type MidiHandler = (msg: MidiMessage) => void;

export class MidiEngine {
  private access: MIDIAccess | null = null;
  private handlers = new Set<MidiHandler>();
  private boundInputs = new Set<string>();
  onDevicesChanged: ((names: string[]) => void) | null = null;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async init(): Promise<string[]> {
    if (!MidiEngine.isSupported()) {
      throw new Error('Web MIDI is not supported in this browser');
    }
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.bindInputs();
    this.access.onstatechange = () => {
      this.bindInputs();
      this.onDevicesChanged?.(this.getInputNames());
    };
    return this.getInputNames();
  }

  getInputNames(): string[] {
    if (!this.access) return [];
    const names: string[] = [];
    this.access.inputs.forEach(input => names.push(input.name || input.id));
    return names;
  }

  onMessage(handler: MidiHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  destroy() {
    this.handlers.clear();
    if (this.access) {
      this.access.inputs.forEach(input => { input.onmidimessage = null; });
      this.access.onstatechange = null;
      this.access = null;
    }
    this.boundInputs.clear();
  }

  private bindInputs() {
    if (!this.access) return;
    this.access.inputs.forEach(input => {
      if (this.boundInputs.has(input.id)) return;
      this.boundInputs.add(input.id);
      input.onmidimessage = (e: MIDIMessageEvent) => this.handleRaw(e);
    });
  }

  private handleRaw(e: MIDIMessageEvent) {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0];
    const kind = status & 0xf0;
    const channel = status & 0x0f;

    let msg: MidiMessage | null = null;
    if (kind === 0xb0 && data.length >= 3) {
      msg = { type: 'cc', channel, controller: data[1], note: -1, value: data[2] / 127 };
    } else if (kind === 0x90 && data.length >= 3) {
      // Note-on with velocity 0 is a note-off by convention
      msg = data[2] === 0
        ? { type: 'noteoff', channel, controller: -1, note: data[1], value: 0 }
        : { type: 'noteon', channel, controller: -1, note: data[1], value: data[2] / 127 };
    } else if (kind === 0x80 && data.length >= 3) {
      msg = { type: 'noteoff', channel, controller: -1, note: data[1], value: data[2] / 127 };
    }
    if (msg) {
      this.handlers.forEach(h => h(msg!));
    }
  }
}
