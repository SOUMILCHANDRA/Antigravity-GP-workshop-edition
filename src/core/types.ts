export const QualityTier = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High'
} as const;

export type QualityTier = (typeof QualityTier)[keyof typeof QualityTier];

export type RenderBackendType = 'WebGPU' | 'WebGL';

export interface QualitySettings {
  tier: QualityTier;
  shadowMapResolution: number;
  pixelRatioCap: number;
  maxVisibleDrawDistance: number;
  antialias: boolean;
  shadowsEnabled: boolean;
  physicsSubsteps: number;
  particlesEnabled: boolean;
  maxTextureResolution: number;
}

export interface EngineStats {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  backend: RenderBackendType;
  deviceMemoryGB?: number;
  hardwareConcurrency?: number;
  gpuAdapterName?: string;
}
