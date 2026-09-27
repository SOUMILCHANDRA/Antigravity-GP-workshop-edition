import * as THREE from 'three';
import { type QualitySettings, type RenderBackendType } from '../core/types';

export interface RendererInitResult {
  renderer: THREE.WebGLRenderer;
  backend: RenderBackendType;
  adapterInfo?: string;
  isWebGPU: boolean;
}

export class RendererManager {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private activeBackend: RenderBackendType = 'WebGL';
  private adapterInfo: string = 'Unknown';
  private forcedBackend: RenderBackendType | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const storedBackend = localStorage.getItem('ag_force_backend') as RenderBackendType | null;
    if (storedBackend === 'WebGL' || storedBackend === 'WebGPU') {
      this.forcedBackend = storedBackend;
    }
  }

  public async init(quality: QualitySettings): Promise<RendererInitResult> {
    console.info(`[RendererManager] Initializing graphics pipeline (Forced: ${this.forcedBackend || 'None'})...`);

    // Check if WebGPU is available & requested
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu !== undefined;
    let tryWebGPU = hasWebGPU;

    if (this.forcedBackend === 'WebGL') {
      tryWebGPU = false;
      console.info('[RendererManager] User forced WebGL backend.');
    } else if (this.forcedBackend === 'WebGPU' && !hasWebGPU) {
      console.warn('[RendererManager] WebGPU forced but navigator.gpu is not available. Falling back to WebGL.');
      tryWebGPU = false;
    }

    if (tryWebGPU) {
      try {
        const gpu = navigator.gpu!;
        const adapter = await gpu.requestAdapter({
          powerPreference: 'high-performance'
        });

        if (adapter) {
          // Dynamic import of Three WebGPU module
          const ThreeWebGPU = await import('three/webgpu');
          const webGpuRenderer = new ThreeWebGPU.WebGPURenderer({
            canvas: this.canvas,
            antialias: quality.antialias,
            powerPreference: 'high-performance'
          });

          await webGpuRenderer.init();

          this.renderer = webGpuRenderer as unknown as THREE.WebGLRenderer;
          this.activeBackend = 'WebGPU';

          // Retrieve adapter info if available
          try {
            const info = (adapter as unknown as { info?: { vendor?: string; architecture?: string; description?: string } }).info;
            this.adapterInfo = info?.description || info?.vendor || 'WebGPU Hardware Adapter';
          } catch {
            this.adapterInfo = 'WebGPU Adapter';
          }

          console.info(`[RendererManager] Successfully initialized WebGPURenderer! Adapter: ${this.adapterInfo}`);
        } else {
          console.warn('[RendererManager] No suitable WebGPU adapter found. Falling back to WebGL.');
          this.initWebGLFallback(quality);
        }
      } catch (err) {
        console.warn('[RendererManager] WebGPURenderer init failed, falling back to WebGL:', err);
        this.initWebGLFallback(quality);
      }
    } else {
      this.initWebGLFallback(quality);
    }

    this.applyQuality(quality);
    this.setupColorManagement();

    return {
      renderer: this.renderer!,
      backend: this.activeBackend,
      adapterInfo: this.adapterInfo,
      isWebGPU: this.activeBackend === 'WebGPU'
    };
  }

  private initWebGLFallback(quality: QualitySettings): void {
    console.info('[RendererManager] Initializing WebGLRenderer fallback...');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false
    });
    this.activeBackend = 'WebGL';

    // Get WebGL GPU unmasked renderer info
    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      this.adapterInfo = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'WebGL Standard Device';
    } else {
      this.adapterInfo = 'WebGL Standard Device';
    }

    console.info(`[RendererManager] Initialized WebGLRenderer! GPU: ${this.adapterInfo}`);
  }

  private setupColorManagement(): void {
    if (!this.renderer) return;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
  }

  public applyQuality(quality: QualitySettings): void {
    if (!this.renderer) return;

    // Pixel ratio cap
    const targetPixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap);
    this.renderer.setPixelRatio(targetPixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    // Shadows
    this.renderer.shadowMap.enabled = quality.shadowsEnabled;
    this.renderer.shadowMap.type = quality.tier === 'High' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }

  public setForcedBackend(backend: RenderBackendType | null): void {
    this.forcedBackend = backend;
    if (backend) {
      localStorage.setItem('ag_force_backend', backend);
    } else {
      localStorage.removeItem('ag_force_backend');
    }
  }

  public getActiveBackend(): RenderBackendType {
    return this.activeBackend;
  }

  public getAdapterInfo(): string {
    return this.adapterInfo;
  }

  public getRenderer(): THREE.WebGLRenderer | null {
    return this.renderer;
  }

  public handleResize(): void {
    if (!this.renderer) return;
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
}
