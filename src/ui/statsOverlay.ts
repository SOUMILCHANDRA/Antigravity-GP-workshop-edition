import * as THREE from 'three';
import { type RenderBackendType } from '../core/types';

export class StatsOverlay {
  private container: HTMLDivElement;
  private fpsEl: HTMLElement;
  private msEl: HTMLElement;
  private backendEl: HTMLElement;
  private callsEl: HTMLElement;
  private trisEl: HTMLElement;
  private gpuEl: HTMLElement;

  private frameCount: number = 0;
  private lastTime: number = performance.now();
  private lastFpsUpdate: number = performance.now();
  private fps: number = 60;
  private frameTimeMs: number = 16.6;

  constructor(backend: RenderBackendType, adapterInfo: string) {
    this.container = document.createElement('div');
    this.container.className = 'stats-overlay glass-panel';

    const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    const cores = navigator.hardwareConcurrency || 4;

    this.container.innerHTML = `
      <div class="stats-header">
        <span class="brand-badge">🏎️ ANTIGRAVITY GP</span>
        <span class="backend-badge ${backend.toLowerCase()}">${backend}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">FPS</span>
          <span class="stat-val stat-fps" id="stat-fps">60</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">FRAME TIME</span>
          <span class="stat-val" id="stat-ms">16.6 ms</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">DRAW CALLS</span>
          <span class="stat-val" id="stat-calls">0</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">TRIANGLES</span>
          <span class="stat-val" id="stat-tris">0</span>
        </div>
      </div>
      <div class="stats-footer">
        <div class="stat-meta"><span>GPU:</span> <span class="meta-val" id="stat-gpu">${adapterInfo}</span></div>
        <div class="stat-meta"><span>HW:</span> <span class="meta-val">${cores} Cores ${memory ? `| ${memory}GB RAM` : ''}</span></div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.fpsEl = this.container.querySelector('#stat-fps')!;
    this.msEl = this.container.querySelector('#stat-ms')!;
    this.backendEl = this.container.querySelector('.backend-badge')!;
    this.callsEl = this.container.querySelector('#stat-calls')!;
    this.trisEl = this.container.querySelector('#stat-tris')!;
    this.gpuEl = this.container.querySelector('#stat-gpu')!;
  }

  public update(renderer: THREE.WebGLRenderer | null, backend: RenderBackendType, adapterInfo: string): void {
    const now = performance.now();
    this.frameCount++;
    const delta = now - this.lastTime;
    this.lastTime = now;
    this.frameTimeMs = delta;

    if (now - this.lastFpsUpdate >= 250) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.fpsEl.textContent = this.fps.toString();
      this.fpsEl.style.color = this.fps >= 55 ? '#00f2fe' : this.fps >= 30 ? '#ffb703' : '#ef233c';

      this.msEl.textContent = `${this.frameTimeMs.toFixed(1)} ms`;
      this.frameCount = 0;
      this.lastFpsUpdate = now;

      if (renderer && renderer.info) {
        this.callsEl.textContent = (renderer.info.render?.calls ?? 0).toString();
        this.trisEl.textContent = (renderer.info.render?.triangles ?? 0).toLocaleString();
      }

      this.backendEl.textContent = backend;
      this.backendEl.className = `backend-badge ${backend.toLowerCase()}`;
      this.gpuEl.textContent = adapterInfo;
    }
  }
}
