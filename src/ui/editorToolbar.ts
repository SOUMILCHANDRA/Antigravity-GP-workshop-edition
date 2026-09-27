import type { TrackControlPoint, TrackData, EditorTool } from '../track/types';
import type { TrackEditor } from '../editor/trackEditor';
import type { GeneratedTrackMesh } from '../track/trackGenerator';
import type { VehicleTelemetry } from '../physics/vehiclePhysics';
import type { LapTimer } from '../racing/lapTimer';
import type { SlipstreamState } from '../racing/slipstream';

export class EditorToolbar {
  private editor: TrackEditor;
  private toolbarEl: HTMLDivElement;
  private inspectorEl: HTMLDivElement;
  private metricsEl: HTMLDivElement;
  private driveHudEl: HTMLDivElement;

  private isDriveMode: boolean = false;
  private activeCameraName: string = 'CHASE';
  private activeWeatherName: string = 'NOON';

  private onDriveModeToggleCallback?: (isDrive: boolean) => void;
  private onOpenStorageCallback?: () => void;
  private onOpenGarageCallback?: () => void;
  private onCycleCameraCallback?: () => void;
  private onCycleWeatherCallback?: () => void;

  constructor(
    editor: TrackEditor,
    onDriveModeToggle?: (isDrive: boolean) => void,
    onOpenStorage?: () => void,
    onOpenGarage?: () => void,
    onCycleCamera?: () => void,
    onCycleWeather?: () => void
  ) {
    this.editor = editor;
    this.onDriveModeToggleCallback = onDriveModeToggle;
    this.onOpenStorageCallback = onOpenStorage;
    this.onOpenGarageCallback = onOpenGarage;
    this.onCycleCameraCallback = onCycleCamera;
    this.onCycleWeatherCallback = onCycleWeather;

    // Create Toolbar Container
    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'editor-toolbar glass-panel';

    // Create Selected Point Inspector Container
    this.inspectorEl = document.createElement('div');
    this.inspectorEl.className = 'point-inspector glass-panel';
    this.inspectorEl.style.display = 'none';

    // Create Track Metrics Container
    this.metricsEl = document.createElement('div');
    this.metricsEl.className = 'track-metrics glass-panel';

    // Create Test Drive HUD Container
    this.driveHudEl = document.createElement('div');
    this.driveHudEl.className = 'drive-hud glass-panel';
    this.driveHudEl.style.display = 'none';

    this.renderToolbar();
    this.renderMetrics(editor.getTrackData(), editor.getGeneratedMesh());

    document.body.appendChild(this.toolbarEl);
    document.body.appendChild(this.inspectorEl);
    document.body.appendChild(this.metricsEl);
    document.body.appendChild(this.driveHudEl);

    this.bindEvents();
  }

  public setCameraName(name: string): void {
    this.activeCameraName = name.toUpperCase();
    this.renderToolbar();
  }

  public setWeatherName(name: string): void {
    this.activeWeatherName = name.toUpperCase();
    this.renderToolbar();
  }

  private renderToolbar(): void {
    const isClosed = this.editor.getTrackData().isClosed;
    const isTopDown = this.editor.isTopDown();
    const activeTool = this.editor.getTool();

    this.toolbarEl.innerHTML = `
      <div class="toolbar-group">
        <button class="tool-btn ${activeTool === 'add' ? 'active' : ''}" data-tool="add" title="Add Point (Click Ground)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Add</span>
        </button>
        <button class="tool-btn ${activeTool === 'select' ? 'active' : ''}" data-tool="select" title="Move & Select Points (Drag XZ)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
          <span>Move</span>
        </button>
        <button class="tool-btn ${activeTool === 'elevation' ? 'active' : ''}" data-tool="elevation" title="Elevation (Drag Point Height)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 12 22 8 18"></polyline><polyline points="8 6 12 2 16 6"></polyline><line x1="12" y1="2" x2="12" y2="22"></line></svg>
          <span>Height</span>
        </button>
        <button class="tool-btn ${activeTool === 'delete' ? 'active' : ''}" data-tool="delete" title="Delete Point (Click or Right-Click)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          <span>Delete</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-group">
        <button class="tool-btn loop-btn ${isClosed ? 'closed' : 'open'}" id="btn-toggle-loop" title="Toggle Closed Circuit Loop">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          <span>${isClosed ? 'Loop: Closed' : 'Loop: Open'}</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-group">
        <button class="tool-btn" id="btn-undo" title="Undo (Ctrl+Z)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
          <span>Undo</span>
        </button>
        <button class="tool-btn" id="btn-redo" title="Redo (Ctrl+Y)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          <span>Redo</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-group">
        <button class="tool-btn view-toggle-btn" id="btn-toggle-view" title="Toggle 2D Top-Down / 3D Orbit View">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
          <span>${isTopDown ? '2D Top-Down' : '3D Orbit View'}</span>
        </button>
        <button class="tool-btn storage-trigger-btn" id="btn-open-storage" title="Save, Load, Export & Presets">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
          <span>💾 Storage</span>
        </button>
        <button class="tool-btn garage-trigger-btn" id="btn-open-garage" title="Select Championship Car">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><path d="m4.93 4.93 4.24 4.24"></path><path d="m14.83 9.17 4.24-4.24"></path></svg>
          <span>🏎️ Cars</span>
        </button>
        <button class="tool-btn weather-trigger-btn" id="btn-cycle-weather" title="Cycle Weather & Lighting">
          <span>🌦️ ${this.activeWeatherName}</span>
        </button>
        <button class="tool-btn camera-trigger-btn" id="btn-cycle-camera" title="Cycle Camera (C)">
          <span>🎥 ${this.activeCameraName}</span>
        </button>
      </div>

      <div class="toolbar-divider"></div>

      <div class="toolbar-group">
        <button class="tool-btn drive-mode-btn ${this.isDriveMode ? 'active-drive' : ''}" id="btn-toggle-drive" title="Test Drive Vehicle (WASD)">
          <span>${this.isDriveMode ? '🛑 Exit Drive' : '🏎️ Test Drive (WASD)'}</span>
        </button>
      </div>
    `;
  }

  public updateSelection(point: TrackControlPoint | null): void {
    if (!point || this.isDriveMode) {
      this.inspectorEl.style.display = 'none';
      return;
    }

    const points = this.editor.getTrackData().points;
    const index = points.findIndex(p => p.id === point.id);

    this.inspectorEl.style.display = 'flex';
    this.inspectorEl.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">POINT #${index + 1} INSPECTOR</span>
        <button class="inspector-close" id="btn-close-inspector">&times;</button>
      </div>
      <div class="inspector-body">
        <div class="inspector-field">
          <label>Height (Y Elevation): <b>${point.position.y.toFixed(1)}m</b></label>
          <input type="range" id="input-elevation" min="-20" max="60" step="0.5" value="${point.position.y}" />
        </div>
        <div class="inspector-field">
          <label>Banking Angle: <b>${point.bankingDeg.toFixed(1)}°</b></label>
          <input type="range" id="input-banking" min="-35" max="35" step="1" value="${point.bankingDeg}" />
        </div>
        <div class="inspector-field">
          <label>Track Width: <b>${point.width.toFixed(1)}m</b></label>
          <input type="range" id="input-width" min="6" max="28" step="1" value="${point.width}" />
        </div>
        <div class="inspector-section-label">SURFACE EXTENSIONS</div>
        <div class="inspector-checkbox-row">
          <label class="check-container">
            <input type="checkbox" id="check-kerb-left" ${point.kerbLeft ? 'checked' : ''} />
            <span>Kerb Left</span>
          </label>
          <label class="check-container">
            <input type="checkbox" id="check-kerb-right" ${point.kerbRight ? 'checked' : ''} />
            <span>Kerb Right</span>
          </label>
        </div>
        <div class="inspector-field">
          <label>Gravel Left Width: <b>${(point.gravelLeftWidth || 0).toFixed(1)}m</b></label>
          <input type="range" id="input-gravel-left" min="0" max="24" step="1" value="${point.gravelLeftWidth || 0}" />
        </div>
        <div class="inspector-field">
          <label>Gravel Right Width: <b>${(point.gravelRightWidth || 0).toFixed(1)}m</b></label>
          <input type="range" id="input-gravel-right" min="0" max="24" step="1" value="${point.gravelRightWidth || 0}" />
        </div>
        <div class="inspector-actions">
          <button class="btn-delete-pt" id="btn-delete-selected">Delete Point</button>
        </div>
      </div>
    `;

    this.bindInspectorEvents(point);
  }

  private bindInspectorEvents(point: TrackControlPoint): void {
    const elInput = this.inspectorEl.querySelector('#input-elevation') as HTMLInputElement;
    const bankInput = this.inspectorEl.querySelector('#input-banking') as HTMLInputElement;
    const widthInput = this.inspectorEl.querySelector('#input-width') as HTMLInputElement;
    const kLeft = this.inspectorEl.querySelector('#check-kerb-left') as HTMLInputElement;
    const kRight = this.inspectorEl.querySelector('#check-kerb-right') as HTMLInputElement;
    const gLeft = this.inspectorEl.querySelector('#input-gravel-left') as HTMLInputElement;
    const gRight = this.inspectorEl.querySelector('#input-gravel-right') as HTMLInputElement;
    const delBtn = this.inspectorEl.querySelector('#btn-delete-selected') as HTMLButtonElement;
    const closeBtn = this.inspectorEl.querySelector('#btn-close-inspector') as HTMLButtonElement;

    if (elInput) elInput.addEventListener('input', () => this.editor.updatePointAttributes(point.id, { elevation: parseFloat(elInput.value) }));
    if (bankInput) bankInput.addEventListener('input', () => this.editor.updatePointAttributes(point.id, { bankingDeg: parseFloat(bankInput.value) }));
    if (widthInput) widthInput.addEventListener('input', () => this.editor.updatePointAttributes(point.id, { width: parseFloat(widthInput.value) }));
    if (kLeft) kLeft.addEventListener('change', () => this.editor.updatePointAttributes(point.id, { kerbLeft: kLeft.checked }));
    if (kRight) kRight.addEventListener('change', () => this.editor.updatePointAttributes(point.id, { kerbRight: kRight.checked }));
    if (gLeft) gLeft.addEventListener('input', () => this.editor.updatePointAttributes(point.id, { gravelLeftWidth: parseFloat(gLeft.value) }));
    if (gRight) gRight.addEventListener('input', () => this.editor.updatePointAttributes(point.id, { gravelRightWidth: parseFloat(gRight.value) }));
    if (delBtn) delBtn.addEventListener('click', () => { this.editor.deletePoint(point.id); this.updateSelection(null); });
    if (closeBtn) closeBtn.addEventListener('click', () => this.updateSelection(null));
  }

  public renderMetrics(trackData: TrackData, mesh: GeneratedTrackMesh | null): void {
    const pointCount = trackData.points.length;
    const isClosed = trackData.isClosed;
    const lengthMeters = mesh ? Math.round(mesh.totalLengthMeters) : 0;
    const triCount = mesh && mesh.roadMesh.geometry.index ? (mesh.roadMesh.geometry.index.count / 3).toLocaleString() : '0';
    const maxBank = mesh ? Math.round(mesh.maxBankingDeg) : 0;

    this.metricsEl.innerHTML = `
      <div class="metrics-header">
        <span class="metrics-title">🏁 CIRCUIT TELEMETRY</span>
      </div>
      <div class="metrics-grid">
        <div class="metric-cell">
          <span class="cell-label">LENGTH</span>
          <span class="cell-val">${lengthMeters} m</span>
        </div>
        <div class="metric-cell">
          <span class="cell-label">NODES</span>
          <span class="cell-val">${pointCount}</span>
        </div>
        <div class="metric-cell">
          <span class="cell-label">ROAD TRIS</span>
          <span class="cell-val">${triCount}</span>
        </div>
        <div class="metric-cell">
          <span class="cell-label">MAX BANKING</span>
          <span class="cell-val">${maxBank}°</span>
        </div>
      </div>
      ${!isClosed ? '<div class="circuit-warning">⚠️ Track loop is open. Connect endpoints to enable racing.</div>' : '<div class="circuit-ready">🏁 Circuit Valid & Ready!</div>'}
    `;
  }

  public updateDriveTelemetry(telemetry: VehicleTelemetry, lapTimer?: LapTimer, slipstream?: SlipstreamState): void {
    if (!this.isDriveMode) {
      this.driveHudEl.style.display = 'none';
      return;
    }

    this.driveHudEl.style.display = 'flex';
    const wheels = telemetry.wheelStates;

    const getSurfaceBadge = (wheelName: 'FL' | 'FR' | 'RL' | 'RR') => {
      const w = wheels.find(s => s.name === wheelName);
      if (!w) return '<span class="surface-pill">--</span>';
      const gripPct = Math.round(w.tireForce.gripFraction * 100);
      const isSliding = gripPct < 75;
      return `<span class="surface-pill pill-${w.surfaceResult.surface.type} ${isSliding ? 'sliding' : ''}">
        ${wheelName}: ${w.surfaceResult.surface.type.toUpperCase()} <small>(${gripPct}%)</small>
      </span>`;
    };

    const gearText = telemetry.currentGear === -1 ? 'R' : telemetry.currentGear === 0 ? 'N' : `${telemetry.currentGear}`;
    const rpmPercent = Math.min(100, Math.max(0, (telemetry.engineRpm / 14000) * 100));

    const currentLapTimeStr = lapTimer ? lapTimer.formatTime(lapTimer.getCurrentLapTime()) : '0:00.000';
    const bestLapTimeStr = lapTimer && lapTimer.getBestLapTime() ? lapTimer.formatTime(lapTimer.getBestLapTime()!) : '--:--.---';
    const lapNumber = lapTimer ? lapTimer.getCurrentLapNumber() : 1;

    this.driveHudEl.innerHTML = `
      <!-- Top Bar: F1 Broadcast Timing Cluster -->
      <div class="hud-lap-timer-cluster">
        <div class="timing-box">
          <span class="timing-label">LAP ${lapNumber}</span>
          <span class="timing-value current-time">${currentLapTimeStr}</span>
        </div>
        <div class="timing-box">
          <span class="timing-label">BEST LAP 🟣</span>
          <span class="timing-value best-time">${bestLapTimeStr}</span>
        </div>
      </div>

      <div class="drive-hud-header">
        <div class="hud-car-badge">
          <span class="hud-car-title">🏎️ ${telemetry.carName}</span>
          <span class="hud-gear-box">GEAR <b>${gearText}</b></span>
        </div>
        <div class="hud-speed-cluster">
          <span class="speed-readout">${telemetry.speedKmh.toFixed(0)} <small>KM/H</small></span>
        </div>
      </div>

      <!-- Tachometer RPM Bar -->
      <div class="tacho-container">
        <div class="tacho-bar-bg">
          <div class="tacho-bar-fill ${rpmPercent > 88 ? 'redline' : ''}" style="width: ${rpmPercent}%"></div>
        </div>
        <div class="tacho-labels">
          <span>RPM: ${telemetry.engineRpm.toLocaleString()}</span>
          <span>G-LAT: ${telemetry.gForceLat >= 0 ? '+' : ''}${telemetry.gForceLat.toFixed(2)}G</span>
          <span>G-LONG: ${telemetry.gForceLong >= 0 ? '+' : ''}${telemetry.gForceLong.toFixed(2)}G</span>
        </div>
      </div>

      ${slipstream && slipstream.inSlipstream ? `
        <div class="slipstream-badge">
          🚀 DRAFTING BEHIND ${slipstream.leaderCarName || 'CAR'} (-${slipstream.dragReductionPercent}% DRAG)
        </div>
      ` : ''}

      <div class="wheels-surface-grid">
        ${getSurfaceBadge('FL')}
        ${getSurfaceBadge('FR')}
        ${getSurfaceBadge('RL')}
        ${getSurfaceBadge('RR')}
      </div>

      <div class="drive-status-row">
        ${telemetry.isOffTrack
          ? '<div class="offtrack-alert">⚠️ OFF-TRACK DETECTED (LAP INVALID)</div>'
          : '<div class="ontrack-status">✅ ALL WHEELS ON TRACK</div>'
        }
      </div>

      ${telemetry.currentDragPenalty > 0.5
        ? `<div class="drag-penalty-readout">🚨 Surface Drag Penalty: -${telemetry.currentDragPenalty.toFixed(1)} m/s²</div>`
        : ''
      }

      <div class="drive-controls-hint">Controls: [W] Throttle | [S] Brake/Reverse | [A/D] Steer | [C] Camera | [R] Reset</div>
    `;
  }

  private bindEvents(): void {
    this.toolbarEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('button');
      if (!target) return;

      const tool = target.getAttribute('data-tool') as EditorTool | null;
      if (tool) {
        this.editor.setTool(tool);
        this.toolbarEl.querySelectorAll('.tool-btn').forEach(b => {
          if (b.hasAttribute('data-tool')) b.classList.remove('active');
        });
        target.classList.add('active');
        return;
      }

      if (target.id === 'btn-toggle-loop') {
        this.editor.toggleCloseLoop();
        this.renderToolbar();
        this.renderMetrics(this.editor.getTrackData(), this.editor.getGeneratedMesh());
      } else if (target.id === 'btn-undo') {
        this.editor.getUndoManager().undo();
      } else if (target.id === 'btn-redo') {
        this.editor.getUndoManager().redo();
      } else if (target.id === 'btn-toggle-view') {
        const next = !this.editor.isTopDown();
        this.editor.setTopDown(next);
        this.renderToolbar();
      } else if (target.id === 'btn-open-storage') {
        if (this.onOpenStorageCallback) this.onOpenStorageCallback();
      } else if (target.id === 'btn-open-garage') {
        if (this.onOpenGarageCallback) this.onOpenGarageCallback();
      } else if (target.id === 'btn-cycle-camera') {
        if (this.onCycleCameraCallback) this.onCycleCameraCallback();
      } else if (target.id === 'btn-cycle-weather') {
        if (this.onCycleWeatherCallback) this.onCycleWeatherCallback();
      } else if (target.id === 'btn-toggle-drive') {
        this.isDriveMode = !this.isDriveMode;
        if (this.onDriveModeToggleCallback) {
          this.onDriveModeToggleCallback(this.isDriveMode);
        }
        this.renderToolbar();
        if (this.isDriveMode) {
          this.inspectorEl.style.display = 'none';
        }
      }
    });
  }
}
