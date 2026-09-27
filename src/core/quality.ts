import { QualityTier, type QualitySettings } from './types';

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  [QualityTier.Low]: {
    tier: QualityTier.Low,
    shadowMapResolution: 512,
    pixelRatioCap: 1.0,
    maxVisibleDrawDistance: 400,
    antialias: false,
    shadowsEnabled: false,
    physicsSubsteps: 1,
    particlesEnabled: false,
    maxTextureResolution: 512
  },
  [QualityTier.Medium]: {
    tier: QualityTier.Medium,
    shadowMapResolution: 1024,
    pixelRatioCap: 1.5,
    maxVisibleDrawDistance: 800,
    antialias: true,
    shadowsEnabled: true,
    physicsSubsteps: 2,
    particlesEnabled: true,
    maxTextureResolution: 1024
  },
  [QualityTier.High]: {
    tier: QualityTier.High,
    shadowMapResolution: 2048,
    pixelRatioCap: Math.min(window.devicePixelRatio || 2.0, 2.0),
    maxVisibleDrawDistance: 1500,
    antialias: true,
    shadowsEnabled: true,
    physicsSubsteps: 4,
    particlesEnabled: true,
    maxTextureResolution: 2048
  }
};

export class QualityManager {
  private currentSettings: QualitySettings;
  private listeners: Array<(settings: QualitySettings) => void> = [];

  constructor() {
    const detectedTier = this.autoDetectTier();
    const savedTier = localStorage.getItem('ag_quality_tier') as QualityTier | null;
    const initialTier = savedTier && Object.values(QualityTier).includes(savedTier)
      ? savedTier
      : detectedTier;

    this.currentSettings = { ...QUALITY_PRESETS[initialTier] };
    console.info(`[QualityManager] Initialized with Tier: ${this.currentSettings.tier} (Auto-detected: ${detectedTier})`);
  }

  public autoDetectTier(): QualityTier {
    // navigator.deviceMemory is in GB (e.g. 2, 4, 8)
    const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    const cores = navigator.hardwareConcurrency || 4;

    console.info(`[QualityManager] Hardware Profile: Memory=${memory ? `${memory}GB` : 'N/A'}, Cores=${cores}`);

    if (memory !== undefined) {
      if (memory <= 4 || cores <= 4) {
        return QualityTier.Low;
      } else if (memory >= 8 && cores >= 8) {
        return QualityTier.High;
      } else {
        return QualityTier.Medium;
      }
    }

    // Fallback based on logical CPU cores
    if (cores >= 8) return QualityTier.High;
    if (cores <= 4) return QualityTier.Low;
    return QualityTier.Medium;
  }

  public getSettings(): QualitySettings {
    return { ...this.currentSettings };
  }

  public setTier(tier: QualityTier): void {
    if (this.currentSettings.tier === tier) return;
    this.currentSettings = { ...QUALITY_PRESETS[tier] };
    localStorage.setItem('ag_quality_tier', tier);
    console.info(`[QualityManager] Quality Tier switched to: ${tier}`, this.currentSettings);
    this.notify();
  }

  public onQualityChange(callback: (settings: QualitySettings) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentSettings);
    }
  }
}

export const qualityManager = new QualityManager();
