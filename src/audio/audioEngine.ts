import { type VehicleTelemetry } from '../physics/vehiclePhysics';
import { type CarSpecs } from '../cars/carData';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isUnlocked: boolean = false;

  // Engine Oscillators & Gains
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private distortionNode: WaveShaperNode | null = null;

  // Tire Screech Noise
  private tireNoiseNode: AudioBufferSourceNode | null = null;
  private tireNoiseGain: GainNode | null = null;

  // Wind Rush Noise
  private windGain: GainNode | null = null;

  private currentCylinders: number = 10;

  constructor() {
    // AudioContext is initialized on first user click to satisfy browser autoplay policy
    const unlockAudio = () => {
      this.init();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
  }

  public init(): void {
    if (this.isUnlocked || typeof window === 'undefined') return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master Gain
      const masterGain = this.ctx.createGain();
      masterGain.gain.value = 0.65;
      masterGain.connect(this.ctx.destination);

      // 1. Setup Engine Oscillators
      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;

      this.engineOsc1.type = 'sawtooth';
      this.engineOsc2.type = 'triangle';

      // WaveShaper distortion for gritty engine throat
      this.distortionNode = this.ctx.createWaveShaper();
      this.distortionNode.curve = this.makeDistortionCurve(18) as any;

      this.engineOsc1.connect(this.distortionNode);
      this.engineOsc2.connect(this.distortionNode);
      this.distortionNode.connect(this.engineGain);
      this.engineGain.connect(masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();

      // 2. Setup Tire Screech Noise (White Noise Buffer)
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.tireNoiseNode = this.ctx.createBufferSource();
      this.tireNoiseNode.buffer = noiseBuffer;
      this.tireNoiseNode.loop = true;

      const tireFilter = this.ctx.createBiquadFilter();
      tireFilter.type = 'bandpass';
      tireFilter.frequency.value = 950;
      tireFilter.Q.value = 3.0;

      this.tireNoiseGain = this.ctx.createGain();
      this.tireNoiseGain.gain.value = 0.0;

      this.tireNoiseNode.connect(tireFilter);
      tireFilter.connect(this.tireNoiseGain);
      this.tireNoiseGain.connect(masterGain);
      this.tireNoiseNode.start();

      // 3. Setup Wind Rush Noise
      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 400;

      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.0;

      const windSource = this.ctx.createBufferSource();
      windSource.buffer = noiseBuffer;
      windSource.loop = true;
      windSource.connect(windFilter);
      windFilter.connect(this.windGain);
      this.windGain.connect(masterGain);
      windSource.start();

      this.isUnlocked = true;
      console.info('[AudioEngine] Procedural Web Audio engine active');
    } catch (err) {
      console.warn('[AudioEngine] Could not initialize Web Audio:', err);
    }
  }

  public setCarSpecs(specs: CarSpecs): void {
    this.currentCylinders = specs.engineCylinders;
  }

  public update(telemetry: VehicleTelemetry, isDriveActive: boolean): void {
    if (!this.ctx || !this.isUnlocked || this.isMuted || !isDriveActive) {
      if (this.engineGain) this.engineGain.gain.setTargetAtTime(0, this.ctx?.currentTime || 0, 0.05);
      if (this.tireNoiseGain) this.tireNoiseGain.gain.setTargetAtTime(0, this.ctx?.currentTime || 0, 0.05);
      if (this.windGain) this.windGain.gain.setTargetAtTime(0, this.ctx?.currentTime || 0, 0.05);
      return;
    }

    const now = this.ctx.currentTime;
    const rpm = telemetry.engineRpm;

    // 1. Engine Frequency = (RPM / 60) * (Cylinders / 2)
    const fundamentalFreq = (rpm / 60) * (this.currentCylinders / 2);
    if (this.engineOsc1 && this.engineOsc2 && this.engineGain) {
      this.engineOsc1.frequency.setTargetAtTime(fundamentalFreq, now, 0.03);
      this.engineOsc2.frequency.setTargetAtTime(fundamentalFreq * 1.5, now, 0.03); // 2nd harmonic

      // Engine volume scales with throttle and RPM
      const targetGain = 0.12 + (telemetry.throttle * 0.18) + (rpm / 14000) * 0.12;
      this.engineGain.gain.setTargetAtTime(targetGain, now, 0.04);
    }

    // 2. Tire Screech Volume (increases when slip grip fraction < 0.75)
    if (this.tireNoiseGain) {
      let maxSlip = 0;
      telemetry.wheelStates.forEach(w => {
        if (w.isGrounded && w.tireForce.gripFraction < 0.75) {
          maxSlip = Math.max(maxSlip, 1.0 - w.tireForce.gripFraction);
        }
      });
      const screechVol = maxSlip * 0.35;
      this.tireNoiseGain.gain.setTargetAtTime(screechVol, now, 0.04);
    }

    // 3. Wind Rush Volume
    if (this.windGain) {
      const windVol = (telemetry.speedKmh / 350) * 0.25;
      this.windGain.gain.setTargetAtTime(windVol, now, 0.08);
    }
  }

  private makeDistortionCurve(amount: number): Float32Array {
    const k = typeof amount === 'number' ? amount : 50;
    const nSamples = 44100;
    const curve = new Float32Array(nSamples);
    const deg = Math.PI / 180;
    for (let i = 0; i < nSamples; ++i) {
      const x = (i * 2) / nSamples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }
}
