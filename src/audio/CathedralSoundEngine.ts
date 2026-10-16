/**
 * Procedural Cathedral Web Audio Synthesizer
 * Generates custom liturgical tones, stone sliding friction, shattering stone,
 * and high gothic D-minor pipe organ chords with bronze sanctuary bell harmonics without any external audio files.
 */
export class CathedralSoundEngine {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  constructor() {
    // Initialized lazily on first user interaction to comply with browser autoplay policies
  }

  public init(): void {
    if (typeof window === 'undefined') return;

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        // Ignored if user hasn't interacted yet
      });
    }
  }

  /**
   * High-pitch celestial chime on square/piece selection
   */
  public playSelect(): void {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(528, now);
    osc.frequency.exponentialRampToValueAtTime(792, now + 0.14);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.17);
  }

  /**
   * Heavy marble/obsidian pedestal friction scrape along the Cosmati pavement
   */
  public playStoneSlide(duration: number = 0.5): void {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.45;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.linearRampToValueAtTime(175, now + duration);
    filter.Q.value = 3.2;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.08);
    gain.gain.linearRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);

    // Heavy marble thud at conclusion of sliding
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(98, now + duration - 0.07);
    thud.frequency.exponentialRampToValueAtTime(36, now + duration + 0.12);

    thudGain.gain.setValueAtTime(0.24, now + duration - 0.07);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.14);

    thud.connect(thudGain);
    thudGain.connect(this.ctx.destination);

    thud.start(now + duration - 0.07);
    thud.stop(now + duration + 0.15);
  }

  /**
   * Shattering stone strike: cleaving weapon impact, stone explosion, and bouncing shard clinks
   */
  public playMeleeShatter(): void {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. Metallic weapon cleave impact
    const impactOsc = this.ctx.createOscillator();
    const impactGain = this.ctx.createGain();
    impactOsc.type = 'sawtooth';
    impactOsc.frequency.setValueAtTime(165, now);
    impactOsc.frequency.exponentialRampToValueAtTime(28, now + 0.45);

    impactGain.gain.setValueAtTime(0.42, now);
    impactGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    impactOsc.connect(impactGain);
    impactGain.connect(this.ctx.destination);
    impactOsc.start(now);
    impactOsc.stop(now + 0.5);

    // 2. Crashing stone burst
    const dur = 0.85;
    const bufSize = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.25));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 550;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.38, now);
    nGain.gain.exponentialRampToValueAtTime(0.002, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.ctx.destination);
    noise.start(now);

    // 3. Cascading individual shard clinks on Cosmati pavement
    for (let c = 0; c < 8; c++) {
      const delay = 0.08 + Math.random() * 0.55;
      const clink = this.ctx.createOscillator();
      const cGain = this.ctx.createGain();
      clink.type = 'sine';
      clink.frequency.setValueAtTime(1100 + Math.random() * 1900, now + delay);
      cGain.gain.setValueAtTime(0.06, now + delay);
      cGain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.09);

      clink.connect(cGain);
      cGain.connect(this.ctx.destination);
      clink.start(now + delay);
      clink.stop(now + delay + 0.1);
    }
  }

  /**
   * Resonant D-minor pipe organ chord combined with bronze sanctuary bell harmonic
   */
  public playCathedralOrganAndBell(): void {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const freqs = [146.83, 220.0, 293.66, 349.23, 587.33];

    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx === 4 ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(f, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = idx === 4 ? 2400 : 680;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(idx === 4 ? 0.12 : 0.055, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.85);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 1.9);
    });
  }
}
