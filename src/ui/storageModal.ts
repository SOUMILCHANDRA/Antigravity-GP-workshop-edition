import { TrackStorage } from '../track/trackStorage';
import type { TrackEditor } from '../editor/trackEditor';
import type { StartFinishGate } from '../track/startFinishGate';
import type { SerializedTrackFile } from '../track/serializationSchema';

export class StorageModal {
  private editor: TrackEditor;
  private gate: StartFinishGate;
  private modalEl: HTMLDivElement;
  private onTrackLoadedCallback?: (serialized: SerializedTrackFile) => void;

  constructor(
    editor: TrackEditor,
    gate: StartFinishGate,
    onTrackLoaded?: (serialized: SerializedTrackFile) => void
  ) {
    this.editor = editor;
    this.gate = gate;
    this.onTrackLoadedCallback = onTrackLoaded;

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'storage-modal-overlay';
    this.modalEl.style.display = 'none';

    document.body.appendChild(this.modalEl);
    this.render();
  }

  public open(): void {
    this.modalEl.style.display = 'flex';
    this.render();
  }

  public close(): void {
    this.modalEl.style.display = 'none';
  }

  public render(): void {
    const trackData = this.editor.getTrackData();
    const gateData = this.gate.getData();
    const serialized = TrackStorage.serialize(trackData, gateData);
    const report = TrackStorage.validate(serialized);
    const catalog = TrackStorage.getCatalog();
    const presets = TrackStorage.getPresetTracks();

    this.modalEl.innerHTML = `
      <div class="storage-modal-content glass-panel">
        <div class="storage-header">
          <div class="storage-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            <span>CIRCUIT DESIGN STORAGE & PRESETS</span>
          </div>
          <button class="modal-close-btn" id="btn-close-storage">&times;</button>
        </div>

        <div class="storage-body">
          <!-- Active Track Metadata & Quick Save -->
          <div class="storage-card">
            <label class="card-label">ACTIVE TRACK METADATA</label>
            <div class="meta-inputs">
              <input type="text" id="input-track-name" class="custom-input" value="${trackData.name}" placeholder="Circuit Name">
              <div class="save-actions-row">
                <button class="action-btn btn-save" id="btn-save-local">💾 Save to Browser</button>
                <button class="action-btn btn-export" id="btn-export-file">📁 Export .JSON</button>
                <label class="action-btn btn-import">
                  📤 Import .JSON
                  <input type="file" id="input-import-file" accept=".json" style="display: none;">
                </label>
              </div>
            </div>

            <!-- Validation Report Card -->
            <div class="validation-box ${report.isValid ? 'valid' : 'invalid'}">
              <div class="val-header">
                <span>Circuit Validation: ${report.isValid ? '✅ VALID' : '❌ INVALID'}</span>
                <span>Length: ${(report.stats.lengthMeters / 1000).toFixed(2)} km | ${report.stats.pointCount} Pts</span>
              </div>
              ${report.warnings.length > 0 ? `
                <div class="val-warnings">
                  ${report.warnings.map(w => `<div class="warn-item">⚠️ ${w}</div>`).join('')}
                </div>
              ` : ''}
              ${report.errors.length > 0 ? `
                <div class="val-errors">
                  ${report.errors.map(e => `<div class="err-item">⛔ ${e}</div>`).join('')}
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Preset Circuits Gallery -->
          <div class="storage-card">
            <label class="card-label">CHAMPIONSHIP PRESET CIRCUITS</label>
            <div class="presets-grid">
              ${presets.map(p => `
                <div class="preset-item">
                  <div class="preset-info">
                    <div class="preset-name">${p.metadata.name}</div>
                    <div class="preset-desc">${p.metadata.description || ''}</div>
                    <div class="preset-meta">${p.points.length} Points | ${p.config.isClosed ? 'Closed Loop' : 'Sprint'}</div>
                  </div>
                  <button class="btn-load-preset" data-preset-id="${p.metadata.id}">Load Circuit</button>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Browser Saved Circuits Catalog -->
          ${catalog.length > 0 ? `
            <div class="storage-card">
              <label class="card-label">SAVED CIRCUITS IN BROWSER STORAGE</label>
              <div class="catalog-list">
                ${catalog.map(c => `
                  <div class="catalog-item">
                    <div class="cat-info">
                      <span class="cat-name">${c.name}</span>
                      <span class="cat-date">${new Date(c.updatedAt).toLocaleDateString()} (${c.pointCount} Pts)</span>
                    </div>
                    <button class="btn-load-saved" data-saved-id="${c.id}">Load</button>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.bindEvents(presets);
  }

  private bindEvents(presets: SerializedTrackFile[]): void {
    const closeBtn = this.modalEl.querySelector<HTMLButtonElement>('#btn-close-storage');
    closeBtn?.addEventListener('click', () => this.close());

    // Save Name Input
    const nameInput = this.modalEl.querySelector<HTMLInputElement>('#input-track-name');
    nameInput?.addEventListener('input', () => {
      this.editor.getTrackData().name = nameInput.value;
    });

    // Save to LocalStorage
    const saveBtn = this.modalEl.querySelector<HTMLButtonElement>('#btn-save-local');
    saveBtn?.addEventListener('click', () => {
      const trackData = this.editor.getTrackData();
      const gateData = this.gate.getData();
      const serialized = TrackStorage.serialize(trackData, gateData);
      TrackStorage.saveToLocalStorage(serialized);
      saveBtn.textContent = '✅ Saved!';
      setTimeout(() => {
        this.render();
      }, 800);
    });

    // Export File
    const exportBtn = this.modalEl.querySelector<HTMLButtonElement>('#btn-export-file');
    exportBtn?.addEventListener('click', () => {
      const trackData = this.editor.getTrackData();
      const gateData = this.gate.getData();
      const serialized = TrackStorage.serialize(trackData, gateData);
      TrackStorage.exportToFile(serialized);
    });

    // Import File
    const importInput = this.modalEl.querySelector<HTMLInputElement>('#input-import-file');
    importInput?.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files[0]) {
        try {
          const file = target.files[0];
          const parsed = await TrackStorage.importFromFile(file);
          if (this.onTrackLoadedCallback) {
            this.onTrackLoadedCallback(parsed);
          }
          this.close();
        } catch (err) {
          alert(`Failed to import track file: ${(err as Error).message}`);
        }
      }
    });

    // Load Preset buttons
    const presetButtons = this.modalEl.querySelectorAll<HTMLButtonElement>('.btn-load-preset');
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-preset-id');
        const preset = presets.find(p => p.metadata.id === id);
        if (preset && this.onTrackLoadedCallback) {
          this.onTrackLoadedCallback(preset);
          this.close();
        }
      });
    });

    // Load Saved buttons
    const savedButtons = this.modalEl.querySelectorAll<HTMLButtonElement>('.btn-load-saved');
    savedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-saved-id');
        if (id) {
          const saved = TrackStorage.loadFromLocalStorage(id);
          if (saved && this.onTrackLoadedCallback) {
            this.onTrackLoadedCallback(saved);
            this.close();
          }
        }
      });
    });
  }
}
