import * as THREE from 'three';
import type { TrackControlPoint, TrackData, EditorTool, EditorState } from '../track/types';
import { TrackGenerator, type GeneratedTrackMesh } from '../track/trackGenerator';
import { StartFinishGate } from '../track/startFinishGate';
import { UndoManager } from './undoManager';
import type { StartFinishGateData } from '../track/serializationSchema';

export class TrackEditor {
  private scene: THREE.Scene;
  private domElement: HTMLElement;
  private camera3D: THREE.PerspectiveCamera;
  private cameraOrtho: THREE.OrthographicCamera;
  private activeCamera: THREE.Camera;

  private trackData: TrackData;
  private generatedTrack: GeneratedTrackMesh | null = null;
  private trackGroup: THREE.Group;
  private handlesGroup: THREE.Group;
  private startFinishGate: StartFinishGate;
  private gateSampleIndex: number = 0;

  private state: EditorState = {
    activeTool: 'add',
    selectedPointId: null,
    hoveredPointId: null,
    isTopDown: true,
    gridSnap: true,
    snapGridSize: 5,
    testDriveMode: false
  };

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Dragging state
  private isDragging = false;
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private dragInitialPoints: TrackControlPoint[] = [];
  private dragPoint: TrackControlPoint | null = null;

  private undoManager: UndoManager;
  private onTrackUpdatedCallback?: (trackData: TrackData, mesh: GeneratedTrackMesh | null) => void;
  private onSelectionChangedCallback?: (selectedPoint: TrackControlPoint | null) => void;

  constructor(
    scene: THREE.Scene,
    domElement: HTMLElement,
    camera3D: THREE.PerspectiveCamera,
    onTrackUpdated?: (trackData: TrackData, mesh: GeneratedTrackMesh | null) => void,
    onSelectionChanged?: (selectedPoint: TrackControlPoint | null) => void
  ) {
    this.scene = scene;
    this.domElement = domElement;
    this.camera3D = camera3D;
    this.onTrackUpdatedCallback = onTrackUpdated;
    this.onSelectionChangedCallback = onSelectionChanged;

    this.undoManager = new UndoManager(() => {
      this.rebuildMesh();
      this.rebuildHandles();
    });

    // Setup Orthographic top-down camera
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 180;
    this.cameraOrtho = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      1,
      2000
    );
    this.cameraOrtho.position.set(0, 200, 0);
    this.cameraOrtho.lookAt(0, 0, 0);

    this.activeCamera = this.cameraOrtho;

    // Groups
    this.trackGroup = new THREE.Group();
    this.handlesGroup = new THREE.Group();
    this.startFinishGate = new StartFinishGate();

    this.scene.add(this.trackGroup);
    this.scene.add(this.handlesGroup);
    this.scene.add(this.startFinishGate.group);

    // Initial default track loop
    this.trackData = this.createDefaultCircuit();

    this.initEventListeners();
    this.rebuildMesh();
    this.rebuildHandles();
  }

  private createDefaultCircuit(): TrackData {
    // Generates an initial iconic F1-inspired test circuit with kerbs and gravel traps
    const rawPoints: Array<{ pos: [number, number, number]; bank: number; kerbL?: boolean; kerbR?: boolean; gL?: number; gR?: number }> = [
      { pos: [-50, 0, -40], bank: 0, kerbL: false, kerbR: false, gL: 0, gR: 0 },          // 0: Main Straight Start
      { pos: [0, 0, -40], bank: 0, kerbL: false, kerbR: false, gL: 0, gR: 0 },            // 1: Pit Straight
      { pos: [50, 0, -40], bank: 5, kerbL: false, kerbR: true, gL: 12, gR: 0 },          // 2: Turn 1 Entry (Right kerb, Left gravel)
      { pos: [75, 4, -10], bank: 15, kerbL: false, kerbR: true, gL: 16, gR: 0 },         // 3: Turn 2 Crest Apex
      { pos: [65, 6, 25], bank: 12, kerbL: false, kerbR: true, gL: 14, gR: 0 },          // 4: Turn 3 High-speed right
      { pos: [30, 3, 45], bank: 0, kerbL: true, kerbR: false, gL: 0, gR: 8 },            // 5: Back straight entry
      { pos: [-20, 0, 45], bank: 0, kerbL: false, kerbR: false, gL: 0, gR: 0 },          // 6: Back straight
      { pos: [-60, 2, 35], bank: -10, kerbL: true, kerbR: false, gL: 0, gR: 15 },        // 7: Hairpin entry
      { pos: [-75, 0, 10], bank: -12, kerbL: true, kerbR: false, gL: 0, gR: 16 },        // 8: Hairpin apex
      { pos: [-65, 0, -20], bank: -5, kerbL: false, kerbR: true, gL: 10, gR: 0 }         // 9: Final bend onto straight
    ];

    const points: TrackControlPoint[] = rawPoints.map((p, idx) => ({
      id: `pt_${Date.now()}_${idx}`,
      position: new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
      bankingDeg: p.bank,
      width: 13,
      kerbLeft: p.kerbL,
      kerbRight: p.kerbR,
      gravelLeftWidth: p.gL,
      gravelRightWidth: p.gR
    }));

    return {
      id: 'default_circuit_01',
      name: 'Autodromo Antigravita',
      isClosed: true,
      defaultWidth: 13,
      points
    };
  }

  public setTool(tool: EditorTool): void {
    this.state.activeTool = tool;
  }

  public getTool(): EditorTool {
    return this.state.activeTool;
  }

  public setTopDown(isTopDown: boolean): void {
    this.state.isTopDown = isTopDown;
    this.activeCamera = isTopDown ? this.cameraOrtho : this.camera3D;
    if (isTopDown) {
      // Focus ortho camera on track center
      if (this.trackData.points.length > 0) {
        const center = new THREE.Vector3();
        this.trackData.points.forEach(p => center.add(p.position));
        center.divideScalar(this.trackData.points.length);
        this.cameraOrtho.position.set(center.x, 250, center.z);
        this.cameraOrtho.lookAt(center.x, 0, center.z);
      }
    }
  }

  public isTopDown(): boolean {
    return this.state.isTopDown;
  }

  public getActiveCamera(): THREE.Camera {
    return this.activeCamera;
  }

  public getTrackData(): TrackData {
    return this.trackData;
  }

  public getGeneratedMesh(): GeneratedTrackMesh | null {
    return this.generatedTrack;
  }

  public getUndoManager(): UndoManager {
    return this.undoManager;
  }

  public toggleCloseLoop(): boolean {
    if (this.trackData.points.length < 3) {
      return false;
    }

    const previousClosed = this.trackData.isClosed;
    const newClosed = !previousClosed;

    this.undoManager.execute({
      name: newClosed ? 'Close Loop' : 'Open Track',
      undo: () => {
        this.trackData.isClosed = previousClosed;
        this.rebuildMesh();
        this.rebuildHandles();
      },
      redo: () => {
        this.trackData.isClosed = newClosed;
        this.rebuildMesh();
        this.rebuildHandles();
      }
    });

    return this.trackData.isClosed;
  }

  public clearTrack(): void {
    const previousPoints = UndoManager.clonePoints(this.trackData.points);
    const previousClosed = this.trackData.isClosed;

    this.undoManager.execute({
      name: 'Clear Track',
      undo: () => {
        this.trackData.points = UndoManager.clonePoints(previousPoints);
        this.trackData.isClosed = previousClosed;
        this.rebuildMesh();
        this.rebuildHandles();
      },
      redo: () => {
        this.trackData.points = [];
        this.trackData.isClosed = false;
        this.state.selectedPointId = null;
        this.rebuildMesh();
        this.rebuildHandles();
      }
    });
  }

  public updateSelectedPoint(updates: Partial<TrackControlPoint>): void {
    if (!this.state.selectedPointId) return;
    const pt = this.trackData.points.find(p => p.id === this.state.selectedPointId);
    if (!pt) return;

    if (updates.bankingDeg !== undefined) pt.bankingDeg = updates.bankingDeg;
    if (updates.width !== undefined) pt.width = updates.width;
    if (updates.position) pt.position.copy(updates.position);
    if (updates.kerbLeft !== undefined) pt.kerbLeft = updates.kerbLeft;
    if (updates.kerbRight !== undefined) pt.kerbRight = updates.kerbRight;
    if (updates.gravelLeftWidth !== undefined) pt.gravelLeftWidth = updates.gravelLeftWidth;
    if (updates.gravelRightWidth !== undefined) pt.gravelRightWidth = updates.gravelRightWidth;

    this.rebuildMesh();
    this.rebuildHandles();

    if (this.onSelectionChangedCallback) {
      this.onSelectionChangedCallback(pt);
    }
  }

  public updatePointAttributes(id: string, updates: Partial<TrackControlPoint> & { elevation?: number }): void {
    const pt = this.trackData.points.find(p => p.id === id);
    if (!pt) return;

    if (updates.elevation !== undefined) pt.position.y = updates.elevation;
    if (updates.bankingDeg !== undefined) pt.bankingDeg = updates.bankingDeg;
    if (updates.width !== undefined) pt.width = updates.width;
    if (updates.kerbLeft !== undefined) pt.kerbLeft = updates.kerbLeft;
    if (updates.kerbRight !== undefined) pt.kerbRight = updates.kerbRight;
    if (updates.gravelLeftWidth !== undefined) pt.gravelLeftWidth = updates.gravelLeftWidth;
    if (updates.gravelRightWidth !== undefined) pt.gravelRightWidth = updates.gravelRightWidth;

    this.rebuildMesh();
    this.rebuildHandles();
  }

  public deleteSelectedPoint(): void {
    if (!this.state.selectedPointId) return;
    this.deletePoint(this.state.selectedPointId);
  }

  public deletePoint(id: string): void {
    const index = this.trackData.points.findIndex(p => p.id === id);
    if (index === -1) return;

    const removedPoint = this.trackData.points[index];
    const previousClosed = this.trackData.isClosed;

    this.undoManager.execute({
      name: 'Delete Point',
      undo: () => {
        this.trackData.points.splice(index, 0, removedPoint);
        this.trackData.isClosed = previousClosed;
        this.state.selectedPointId = removedPoint.id;
        this.rebuildMesh();
        this.rebuildHandles();
      },
      redo: () => {
        this.trackData.points.splice(index, 1);
        if (this.trackData.points.length < 3) {
          this.trackData.isClosed = false;
        }
        this.state.selectedPointId = null;
        this.rebuildMesh();
        this.rebuildHandles();
      }
    });
  }

  public getStartFinishGate(): StartFinishGate {
    return this.startFinishGate;
  }

  public setGateSampleIndex(idx: number): void {
    this.gateSampleIndex = idx;
    if (this.generatedTrack && this.generatedTrack.samples.length > 0) {
      this.startFinishGate.updatePositionFromSpline(this.generatedTrack.samples, this.gateSampleIndex);
    }
  }

  public loadTrack(trackData: TrackData, gateData?: StartFinishGateData): void {
    this.trackData = {
      id: trackData.id,
      name: trackData.name,
      isClosed: trackData.isClosed,
      defaultWidth: trackData.defaultWidth,
      points: UndoManager.clonePoints(trackData.points)
    };

    if (gateData) {
      this.gateSampleIndex = gateData.sampleIndex || 0;
    } else {
      this.gateSampleIndex = 0;
    }

    this.state.selectedPointId = null;
    this.undoManager.clear();
    this.rebuildMesh();
    this.rebuildHandles();
    console.info(`[TrackEditor] Loaded track "${trackData.name}" (${trackData.points.length} points)`);
  }

  public rebuildMesh(): void {
    // Clear old mesh
    while (this.trackGroup.children.length > 0) {
      const child = this.trackGroup.children[0] as THREE.Mesh;
      if (child.geometry) child.geometry.dispose();
      this.trackGroup.remove(child);
    }

    if (this.trackData.points.length < 2) {
      this.generatedTrack = null;
      this.startFinishGate.group.visible = false;
      if (this.onTrackUpdatedCallback) {
        this.onTrackUpdatedCallback(this.trackData, null);
      }
      return;
    }

    this.generatedTrack = TrackGenerator.generateTrack(
      this.trackData.points,
      this.trackData.isClosed
    );

    if (this.generatedTrack) {
      this.trackGroup.add(this.generatedTrack.roadMesh);
      if (this.generatedTrack.kerbMesh) {
        this.trackGroup.add(this.generatedTrack.kerbMesh);
      }
      if (this.generatedTrack.gravelMesh) {
        this.trackGroup.add(this.generatedTrack.gravelMesh);
      }
      this.trackGroup.add(this.generatedTrack.substructureMesh);
      this.trackGroup.add(this.generatedTrack.centerlineLine);

      // Update Start/Finish Gate placement
      this.startFinishGate.group.visible = true;
      this.startFinishGate.updatePositionFromSpline(this.generatedTrack.samples, this.gateSampleIndex);
    }

    if (this.onTrackUpdatedCallback) {
      this.onTrackUpdatedCallback(this.trackData, this.generatedTrack);
    }
  }

  public rebuildHandles(): void {
    while (this.handlesGroup.children.length > 0) {
      const child = this.handlesGroup.children[0] as THREE.Mesh;
      if (child.geometry) child.geometry.dispose();
      this.handlesGroup.remove(child);
    }

    const sphereGeo = new THREE.SphereGeometry(1.2, 16, 16);

    this.trackData.points.forEach((pt, index) => {
      const isSelected = pt.id === this.state.selectedPointId;
      const isStart = index === 0;

      // Color coding: Start point is gold, selected point is bright orange/cyan, regular is blue
      const handleColor = isSelected
        ? 0xff9f1c
        : isStart
        ? 0xffd166
        : 0x00b4d8;

      const handleMat = new THREE.MeshStandardMaterial({
        color: handleColor,
        emissive: handleColor,
        emissiveIntensity: isSelected ? 0.6 : 0.2,
        roughness: 0.3,
        metalness: 0.8
      });

      const handleMesh = new THREE.Mesh(sphereGeo, handleMat);
      handleMesh.position.copy(pt.position);
      handleMesh.userData = { pointId: pt.id, pointIndex: index, type: 'controlPoint' };
      this.handlesGroup.add(handleMesh);

      // Elevation pillar line (if point has elevation > 0.1m)
      if (pt.position.y > 0.1) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(pt.position.x, 0, pt.position.z),
          pt.position.clone()
        ]);
        const lineMat = new THREE.LineBasicMaterial({
          color: isSelected ? 0xff9f1c : 0x556677,
          transparent: true,
          opacity: 0.8
        });
        const pillarLine = new THREE.Line(lineGeo, lineMat);
        this.handlesGroup.add(pillarLine);
      }

      // Banking angle visualization arrow for selected / hovered points
      if (isSelected || Math.abs(pt.bankingDeg) > 1) {
        const arrowDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(pt.bankingDeg));
        const arrow = new THREE.ArrowHelper(arrowDir, pt.position, 3.5, isSelected ? 0x00f2fe : 0xffffff, 0.8, 0.4);
        this.handlesGroup.add(arrow);
      }
    });

    const selectedPt = this.trackData.points.find(p => p.id === this.state.selectedPointId) || null;
    if (this.onSelectionChangedCallback) {
      this.onSelectionChangedCallback(selectedPt);
    }
  }

  private initEventListeners(): void {
    this.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.domElement.addEventListener('contextmenu', this.onContextMenu.bind(this));

    window.addEventListener('keydown', (e) => {
      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undoManager.undo();
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.undoManager.redo();
      }
      // Delete selected point: Delete or Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.state.selectedPointId) {
          e.preventDefault();
          this.deleteSelectedPoint();
        }
      }
    });
  }

  private updateRaycaster(event: PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.activeCamera);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return; // Only primary mouse button for drag/placement

    this.updateRaycaster(event);
    const intersects = this.raycaster.intersectObjects(this.handlesGroup.children, true);

    const hitHandle = intersects.find(i => i.object.userData?.type === 'controlPoint');

    if (hitHandle) {
      const pointId = hitHandle.object.userData.pointId;
      const pt = this.trackData.points.find(p => p.id === pointId);
      if (!pt) return;

      if (this.state.activeTool === 'delete') {
        this.deletePoint(pointId);
        return;
      }

      this.state.selectedPointId = pointId;
      this.dragPoint = pt;
      this.isDragging = true;
      this.dragInitialPoints = UndoManager.clonePoints(this.trackData.points);

      // Elevation tool or Shift key drags vertically
      const isElevationDrag = this.state.activeTool === 'elevation' || event.shiftKey;
      if (isElevationDrag) {
        // Vertical drag plane facing the camera
        const normal = new THREE.Vector3();
        this.activeCamera.getWorldDirection(normal);
        normal.y = 0;
        normal.normalize();
        this.dragPlane.setFromNormalAndCoplanarPoint(normal, pt.position);
      } else {
        // Horizontal plane at point's elevation
        this.dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), pt.position);
      }

      const intersection = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) {
        this.dragOffset.copy(pt.position).sub(intersection);
      }

      this.rebuildHandles();
      return;
    }

    // Clicking on ground in 'add' tool mode places a new point
    if (this.state.activeTool === 'add') {
      const groundHit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, groundHit)) {
        let pos = groundHit.clone();
        if (this.state.gridSnap) {
          const s = this.state.snapGridSize;
          pos.x = Math.round(pos.x / s) * s;
          pos.z = Math.round(pos.z / s) * s;
        }

        const newPoint: TrackControlPoint = {
          id: `pt_${Date.now()}_${this.trackData.points.length}`,
          position: pos,
          bankingDeg: 0,
          width: this.trackData.defaultWidth
        };

        const previousPoints = UndoManager.clonePoints(this.trackData.points);

        this.undoManager.execute({
          name: 'Add Point',
          undo: () => {
            this.trackData.points = UndoManager.clonePoints(previousPoints);
            this.state.selectedPointId = null;
            this.rebuildMesh();
            this.rebuildHandles();
          },
          redo: () => {
            this.trackData.points.push(newPoint);
            this.state.selectedPointId = newPoint.id;
            this.rebuildMesh();
            this.rebuildHandles();
          }
        });
      }
    } else {
      // Clicked on empty space: deselect
      this.state.selectedPointId = null;
      this.rebuildHandles();
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.isDragging && this.dragPoint) {
      this.updateRaycaster(event);
      const intersection = new THREE.Vector3();

      if (this.raycaster.ray.intersectPlane(this.dragPlane, intersection)) {
        const targetPos = intersection.add(this.dragOffset);

        const isElevationDrag = this.state.activeTool === 'elevation' || event.shiftKey;
        if (isElevationDrag) {
          // Clamp elevation between 0m and 60m
          this.dragPoint.position.y = Math.max(0, Math.min(60, targetPos.y));
        } else {
          let nx = targetPos.x;
          let nz = targetPos.z;
          if (this.state.gridSnap) {
            const s = this.state.snapGridSize;
            nx = Math.round(nx / s) * s;
            nz = Math.round(nz / s) * s;
          }
          this.dragPoint.position.x = nx;
          this.dragPoint.position.z = nz;
        }

        this.rebuildMesh();
        this.rebuildHandles();
      }
      return;
    }

    // Hover highlighting
    this.updateRaycaster(event);
    const intersects = this.raycaster.intersectObjects(this.handlesGroup.children, true);
    const hit = intersects.find(i => i.object.userData?.type === 'controlPoint');
    const newHover = hit ? hit.object.userData.pointId : null;

    if (newHover !== this.state.hoveredPointId) {
      this.state.hoveredPointId = newHover;
      this.domElement.style.cursor = newHover ? 'pointer' : 'default';
    }
  }

  private onPointerUp(): void {
    if (this.isDragging && this.dragPoint) {
      const initialPoints = this.dragInitialPoints;
      const currentPoints = UndoManager.clonePoints(this.trackData.points);

      // Record Move action in Undo history
      this.undoManager.execute({
        name: 'Move Point',
        undo: () => {
          this.trackData.points = UndoManager.clonePoints(initialPoints);
          this.rebuildMesh();
          this.rebuildHandles();
        },
        redo: () => {
          this.trackData.points = UndoManager.clonePoints(currentPoints);
          this.rebuildMesh();
          this.rebuildHandles();
        }
      });

      this.isDragging = false;
      this.dragPoint = null;
    }
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault(); // Prevent default browser context menu
    this.updateRaycaster(event as unknown as PointerEvent);
    const intersects = this.raycaster.intersectObjects(this.handlesGroup.children, true);
    const hit = intersects.find(i => i.object.userData?.type === 'controlPoint');

    if (hit) {
      this.deletePoint(hit.object.userData.pointId);
    }
  }

  public handleResize(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 180;
    this.cameraOrtho.left = (frustumSize * aspect) / -2;
    this.cameraOrtho.right = (frustumSize * aspect) / 2;
    this.cameraOrtho.top = frustumSize / 2;
    this.cameraOrtho.bottom = frustumSize / -2;
    this.cameraOrtho.updateProjectionMatrix();
  }
}
