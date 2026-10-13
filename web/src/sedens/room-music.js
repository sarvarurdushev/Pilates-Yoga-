// Music for the room player (brief §26). Off by default. Calm, Focus and Energy are
// simple ambience generated in the browser with WebAudio (no bundled tracks, no
// licensing question); "My own audio" plays a file the customer picks, locally,
// never uploaded. Music has its own volume, separate from narration, and dips
// while narration speaks. Without WebAudio the feature reports itself unavailable.

export const MODES = ["off", "calm", "focus", "energy", "own"];

// Gentle chords (Hz) and pulse rates per mode; quiet by design.
const PRESETS = {
  calm: { notes: [196.0, 246.94, 293.66], pulse: 0, cutoff: 900, level: 0.05 },
  focus: { notes: [220.0, 277.18, 329.63], pulse: 1.0, cutoff: 1200, level: 0.045 },
  energy: { notes: [261.63, 329.63, 392.0], pulse: 1.8, cutoff: 1800, level: 0.04 },
};

export function createMusic({ win = globalThis } = {}) {
  const Context = win && (win.AudioContext || win.webkitAudioContext);
  let ctx = null;
  let master = null;
  let voices = [];
  let mode = "off";
  let volume = 0.5;
  let ducked = false;
  let element = null;
  let objectUrl = null;

  function ensure() {
    if (!Context) return false;
    if (!ctx) {
      try {
        ctx = new Context();
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);
      } catch {
        ctx = null;
        return false;
      }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return true;
  }

  function level() {
    return volume * (ducked ? 0.35 : 1);
  }

  function applyLevel(seconds = 0.4) {
    if (!master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(mode === "off" ? 0 : level(), now, seconds / 3);
  }

  function stopVoices() {
    for (const node of voices) {
      try {
        node.stop?.();
      } catch {
        // already stopped
      }
      try {
        node.disconnect?.();
      } catch {
        // ignore
      }
    }
    voices = [];
    if (element) {
      element.pause();
      element = null;
    }
  }

  function startPreset(preset) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = preset.cutoff;
    const bus = ctx.createGain();
    bus.gain.value = preset.level;
    filter.connect(bus);
    bus.connect(master);
    voices.push(filter, bus);
    for (const [i, freq] of preset.notes.entries()) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = (i - 1) * 4;
      osc.connect(filter);
      osc.start();
      voices.push(osc);
    }
    // A slow swell (calm) or a soft pulse (focus, energy) on the bus level.
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = preset.pulse || 0.07;
    depth.gain.value = preset.level * (preset.pulse ? 0.8 : 0.4);
    lfo.connect(depth);
    depth.connect(bus.gain);
    lfo.start();
    voices.push(lfo, depth);
  }

  return {
    get available() {
      return !!Context;
    },
    get mode() {
      return mode;
    },
    /** Switch mode; call from a user gesture (browsers block audio otherwise). */
    setMode(next) {
      if (!MODES.includes(next)) return mode;
      if (next !== "off" && !ensure()) return mode;
      stopVoices();
      mode = next;
      if (next in PRESETS) startPreset(PRESETS[next]);
      if (next === "own" && objectUrl && ctx) {
        element = new win.Audio(objectUrl);
        element.loop = true;
        try {
          ctx.createMediaElementSource(element).connect(master);
        } catch {
          // Already connected or unsupported: play directly.
        }
        element.play().catch(() => {});
      }
      applyLevel();
      return mode;
    },
    /** The customer's own file; never uploaded, released when replaced or destroyed. */
    useFile(file) {
      if (!file || !win.URL) return false;
      if (objectUrl) win.URL.revokeObjectURL(objectUrl);
      objectUrl = win.URL.createObjectURL(file);
      return true;
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      applyLevel(0.15);
    },
    duck(on) {
      ducked = !!on;
      applyLevel(0.3);
    },
    pause() {
      if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
      if (element) element.pause();
    },
    resume() {
      if (mode === "off") return;
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      if (element) element.play().catch(() => {});
    },
    destroy() {
      stopVoices();
      mode = "off";
      if (objectUrl && win.URL) win.URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
      master = null;
    },
  };
}
