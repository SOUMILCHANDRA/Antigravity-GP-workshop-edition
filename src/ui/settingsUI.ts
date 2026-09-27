import { QualityTier, type RenderBackendType } from '../core/types';
import { qualityManager } from '../core/quality';

export class SettingsUI {
  private container: HTMLDivElement;
  private onBackendChangeCallback?: (backend: RenderBackendType | null) => void;

  constructor(
    currentBackend: RenderBackendType,
    onBackendChange: (backend: RenderBackendType | null) => void
  ) {
    this.onBackendChangeCallback = onBackendChange;
    this.container = document.createElement('div');
    this.container.className = 'settings-panel glass-panel';

    const currentSettings = qualityManager.getSettings();
    const forcedBackend = localStorage.getItem('ag_force_backend') || 'auto';

    this.container.innerHTML = `
      <div class="settings-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        <span>ENGINE & QUALITY SETTINGS</span>
      </div>

      <div class="settings-section">
        <label class="section-label">QUALITY TIER (POTATO-MODE AWARE)</label>
        <div class="tier-buttons">
          <button class="tier-btn ${currentSettings.tier === QualityTier.Low ? 'active' : ''}" data-tier="${QualityTier.Low}">
            <div class="tier-name">LOW</div>
            <div class="tier-desc">Potato / 4GB RAM</div>
          </button>
          <button class="tier-btn ${currentSettings.tier === QualityTier.Medium ? 'active' : ''}" data-tier="${QualityTier.Medium}">
            <div class="tier-name">MEDIUM</div>
            <div class="tier-desc">Balanced / 60 FPS</div>
          </button>
          <button class="tier-btn ${currentSettings.tier === QualityTier.High ? 'active' : ''}" data-tier="${QualityTier.High}">
            <div class="tier-name">HIGH</div>
            <div class="tier-desc">Max Fidelity / 2K</div>
          </button>
        </div>
      </div>

      <div class="settings-section">
        <label class="section-label">RENDER BACKEND</label>
        <div class="backend-select-row">
          <select id="backend-select" class="custom-select">
            <option value="auto" ${forcedBackend === 'auto' ? 'selected' : ''}>Auto-Detect (WebGPU Preferred)</option>
            <option value="WebGPU" ${forcedBackend === 'WebGPU' ? 'selected' : ''}>Force WebGPU</option>
            <option value="WebGL" ${forcedBackend === 'WebGL' ? 'selected' : ''}>Force WebGL Fallback</option>
          </select>
          <span class="active-tag">${currentBackend} Active</span>
        </div>
      </div>

      <div class="settings-section parameters-summary">
        <div class="param-row"><span>Shadow Resolution:</span> <span id="param-shadow">${currentSettings.shadowMapResolution}px</span></div>
        <div class="param-row"><span>Max Draw Distance:</span> <span id="param-dist">${currentSettings.maxVisibleDrawDistance}m</span></div>
        <div class="param-row"><span>Pixel Ratio Cap:</span> <span id="param-pr">${currentSettings.pixelRatioCap}x</span></div>
        <div class="param-row"><span>Antialiasing:</span> <span id="param-aa">${currentSettings.antialias ? 'ON' : 'OFF'}</span></div>
        <div class="param-row"><span>Physics Substeps:</span> <span id="param-physics">${currentSettings.physicsSubsteps}x (120Hz)</span></div>
      </div>

      <div class="phase-indicator">
        <span class="phase-pill active">Phase A: Scaffold & Renderer</span>
        <span class="phase-hint">Orbit: Left Click Drag | Pan: Right Click | Zoom: Scroll</span>
      </div>
    `;

    document.body.appendChild(this.container);
    this.bindEvents();
  }

  private bindEvents(): void {
    const tierButtons = this.container.querySelectorAll<HTMLButtonElement>('.tier-btn');
    tierButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tier = btn.getAttribute('data-tier') as QualityTier;
        if (tier) {
          qualityManager.setTier(tier);
          tierButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.updateParameterReadout();
        }
      });
    });

    const backendSelect = this.container.querySelector<HTMLSelectElement>('#backend-select');
    if (backendSelect) {
      backendSelect.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        const val = target.value;
        const selectedBackend = val === 'auto' ? null : (val as RenderBackendType);
        if (this.onBackendChangeCallback) {
          this.onBackendChangeCallback(selectedBackend);
        }
      });
    }

    qualityManager.onQualityChange(() => {
      this.updateParameterReadout();
    });
  }

  public updateParameterReadout(): void {
    const s = qualityManager.getSettings();
    const shadowEl = this.container.querySelector('#param-shadow');
    const distEl = this.container.querySelector('#param-dist');
    const prEl = this.container.querySelector('#param-pr');
    const aaEl = this.container.querySelector('#param-aa');
    const physEl = this.container.querySelector('#param-physics');

    if (shadowEl) shadowEl.textContent = s.shadowsEnabled ? `${s.shadowMapResolution}px` : 'Disabled';
    if (distEl) distEl.textContent = `${s.maxVisibleDrawDistance}m`;
    if (prEl) prEl.textContent = `${s.pixelRatioCap}x`;
    if (aaEl) aaEl.textContent = s.antialias ? 'ON' : 'OFF';
    if (physEl) physEl.textContent = `${s.physicsSubsteps}x (120Hz)`;
  }
}
