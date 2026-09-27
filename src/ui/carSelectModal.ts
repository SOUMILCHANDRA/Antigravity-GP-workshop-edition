import { CAR_ROSTER } from '../cars/carData';
import { carModelLoader, type LoadedCarAsset } from '../cars/carModelLoader';
import { qualityManager } from '../core/quality';
import { QualityTier } from '../core/types';

export class CarSelectModal {
  private modalEl: HTMLDivElement;
  private selectedCarId: string = 'mclaren_mp45';
  private currentPreviewAsset: LoadedCarAsset | null = null;
  private onCarSelectedCallback?: (carId: string) => void;

  constructor(onCarSelected?: (carId: string) => void) {
    this.onCarSelectedCallback = onCarSelected;

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'car-select-modal-overlay';
    this.modalEl.style.display = 'none';

    document.body.appendChild(this.modalEl);
  }

  public async open(): Promise<void> {
    this.modalEl.style.display = 'flex';
    await this.render();
  }

  public close(): void {
    this.modalEl.style.display = 'none';
  }

  public async render(): Promise<void> {
    const currentTier = qualityManager.getSettings().tier;
    const activeCar = CAR_ROSTER[this.selectedCarId];

    // Load active car asset for live metrics
    this.currentPreviewAsset = await carModelLoader.loadCarModel(this.selectedCarId, currentTier);
    const asset = this.currentPreviewAsset;

    const hpPerTon = Math.round((activeCar.peakHorsepower / activeCar.massKg) * 1000);

    this.modalEl.innerHTML = `
      <div class="car-modal-content glass-panel">
        <div class="car-modal-header">
          <div class="car-modal-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><path d="m4.93 4.93 4.24 4.24"></path><path d="m14.83 9.17 4.24-4.24"></path><path d="m14.83 14.83 4.24 4.24"></path><path d="m9.17 14.83-4.24 4.24"></path></svg>
            <span>CHAMPIONSHIP VEHICLE ROSTER & SPECIFICATIONS</span>
          </div>
          <button class="modal-close-btn" id="btn-close-car-modal">&times;</button>
        </div>

        <div class="car-modal-body">
          <!-- Left: Car Selection Cards Grid -->
          <div class="car-cards-column">
            <label class="column-label">SELECT ERA MACHINE</label>
            <div class="car-selection-list">
              ${Object.values(CAR_ROSTER).map(car => `
                <div class="car-card ${car.id === this.selectedCarId ? 'selected' : ''}" data-car-id="${car.id}">
                  <div class="car-card-header">
                    <span class="car-card-year">${car.year}</span>
                    <span class="car-card-era">${car.era.replace(/_/g, ' ').toUpperCase()}</span>
                  </div>
                  <div class="car-card-name">${car.name}</div>
                  <div class="car-card-engine">${car.engineDescription}</div>
                  <div class="car-card-stats-mini">
                    <span>${car.peakHorsepower} HP</span> •
                    <span>${car.massKg} KG</span> •
                    <span>${car.topSpeedKmh} KM/H</span>
                  </div>
                </div>
              `).join('')}
            </div>

            <!-- Quality Tier LOD Hot-Switcher -->
            <div class="lod-switcher-box">
              <span class="lod-label">ACTIVE QUALITY TIER (LOD MODEL):</span>
              <div class="lod-buttons-row">
                <button class="lod-btn ${currentTier === QualityTier.Low ? 'active' : ''}" data-tier="${QualityTier.Low}">LOW (Potato)</button>
                <button class="lod-btn ${currentTier === QualityTier.Medium ? 'active' : ''}" data-tier="${QualityTier.Medium}">MEDIUM</button>
                <button class="lod-btn ${currentTier === QualityTier.High ? 'active' : ''}" data-tier="${QualityTier.High}">HIGH</button>
              </div>
            </div>
          </div>

          <!-- Right: Detailed Engineering Inspector -->
          <div class="car-details-column">
            <div class="car-hero-card">
              <div class="car-hero-header">
                <div>
                  <h2 class="hero-name">${activeCar.name}</h2>
                  <div class="hero-livery">${activeCar.livery}</div>
                </div>
                <div class="hero-power-badge">
                  <span class="pwr-val">${activeCar.peakHorsepower}</span>
                  <span class="pwr-unit">BHP</span>
                </div>
              </div>
              <p class="hero-desc">${activeCar.historicalNote}</p>
            </div>

            <!-- Detailed Engineering Metrics Grid -->
            <div class="specs-grid">
              <div class="spec-card">
                <span class="spec-label">MASS & DISTRIBUTION</span>
                <span class="spec-val">${activeCar.massKg} kg</span>
                <span class="spec-sub">${Math.round(activeCar.weightDistributionFrontRatio * 100)}% F / ${Math.round((1 - activeCar.weightDistributionFrontRatio) * 100)}% R</span>
              </div>
              <div class="spec-card">
                <span class="spec-label">POWER-TO-WEIGHT</span>
                <span class="spec-val highlight">${hpPerTon} hp/ton</span>
                <span class="spec-sub">${(activeCar.massKg / activeCar.peakHorsepower).toFixed(2)} kg/hp</span>
              </div>
              <div class="spec-card">
                <span class="spec-label">ENGINE & PEAK RPM</span>
                <span class="spec-val">${activeCar.peakHpRpm.toLocaleString()} rpm</span>
                <span class="spec-sub">${activeCar.peakTorqueNm} Nm @ ${activeCar.peakTorqueRpm.toLocaleString()} rpm</span>
              </div>
              <div class="spec-card">
                <span class="spec-label">TOP SPEED BENCHMARK</span>
                <span class="spec-val">${activeCar.topSpeedKmh} km/h</span>
                <span class="spec-sub">${activeCar.gearCount}-Speed Manual</span>
              </div>
            </div>

            <!-- In-Scene 3D Model Bounding Box & Scale Verification -->
            <div class="model-verification-box">
              <div class="verif-title">📐 3D MODEL NORMALIZATION & BOUNDS VERIFICATION</div>
              <div class="verif-grid">
                <div class="verif-item">
                  <span>Measured Length:</span>
                  <b>${asset.boundingBox.length.toFixed(2)}m (Real: ${activeCar.lengthMeters}m)</b>
                </div>
                <div class="verif-item">
                  <span>Measured Width:</span>
                  <b>${asset.boundingBox.width.toFixed(2)}m (Real: ${activeCar.widthMeters}m)</b>
                </div>
                <div class="verif-item">
                  <span>Measured Height:</span>
                  <b>${asset.boundingBox.height.toFixed(2)}m (Real: ${activeCar.heightMeters}m)</b>
                </div>
                <div class="verif-item">
                  <span>Active LOD Triangles:</span>
                  <b class="highlight">${asset.triangleCount.toLocaleString()} tris (${asset.meshCount} meshes)</b>
                </div>
              </div>
            </div>

            <!-- Drive Action Button -->
            <button class="btn-select-and-drive" id="btn-select-car">
              🏎️ SELECT & DRIVE ${activeCar.name.toUpperCase()}
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const closeBtn = this.modalEl.querySelector<HTMLButtonElement>('#btn-close-car-modal');
    closeBtn?.addEventListener('click', () => this.close());

    // Car Cards selection
    const cards = this.modalEl.querySelectorAll<HTMLDivElement>('.car-card');
    cards.forEach(card => {
      card.addEventListener('click', async () => {
        const id = card.getAttribute('data-car-id');
        if (id && id !== this.selectedCarId) {
          this.selectedCarId = id;
          await this.render();
        }
      });
    });

    // LOD Tier buttons
    const lodButtons = this.modalEl.querySelectorAll<HTMLButtonElement>('.lod-btn');
    lodButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const tier = btn.getAttribute('data-tier') as QualityTier;
        if (tier) {
          qualityManager.setTier(tier);
          await this.render();
        }
      });
    });

    // Select & Drive Button
    const selectBtn = this.modalEl.querySelector<HTMLButtonElement>('#btn-select-car');
    selectBtn?.addEventListener('click', () => {
      if (this.onCarSelectedCallback) {
        this.onCarSelectedCallback(this.selectedCarId);
      }
      this.close();
    });
  }

  public getSelectedCarId(): string {
    return this.selectedCarId;
  }
}
