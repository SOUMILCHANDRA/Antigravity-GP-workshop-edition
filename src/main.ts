import './style.css';
import * as THREE from 'three';
import { qualityManager } from './core/quality';
import { RendererManager } from './graphics/renderer';
import { AppScene } from './graphics/scene';
import { TrackEditor } from './editor/trackEditor';
import { EditorToolbar } from './ui/editorToolbar';
import { StorageModal } from './ui/storageModal';
import { CarSelectModal } from './ui/carSelectModal';
import { TrackStorage } from './track/trackStorage';
import { StatsOverlay } from './ui/statsOverlay';
import { SettingsUI } from './ui/settingsUI';
import { rapierWorldManager } from './physics/rapierWorld';
import { VehicleController } from './physics/vehicleController';
import { type RenderBackendType } from './core/types';

async function bootstrap() {
  const canvas = document.getElementById('canvas-3d') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #canvas-3d not found');
  }

  const quality = qualityManager.getSettings();
  const rendererManager = new RendererManager(canvas);

  // Initialize dual-backend renderer (WebGPU with WebGL fallback)
  const initResult = await rendererManager.init(quality);
  const renderer = initResult.renderer;

  // Initialize Scene, Camera, Lighting, Shadows
  const appScene = new AppScene(canvas, quality);

  // Initialize Rapier 3D WASM Physics World (Phase F)
  const physicsWorld = await rapierWorldManager.init();

  // Chase Camera for Test Drive Mode
  const chaseCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, quality.maxVisibleDrawDistance);
  chaseCamera.position.set(0, 5, -10);

  // Initialize Core Vehicle Controller with Rapier 4-Wheel Physics (Phase F)
  const vehicleController = new VehicleController(appScene.scene, physicsWorld);
  let isDriveModeActive = false;

  // Forward declarations for toolbar & editor coupling
  let editorToolbar: EditorToolbar;
  let storageModal: StorageModal;
  let carSelectModal: CarSelectModal;

  // Initialize Track Editor (Phase B & C & D)
  const trackEditor = new TrackEditor(
    appScene.scene,
    canvas,
    appScene.camera,
    (trackData, mesh) => {
      if (editorToolbar) {
        editorToolbar.renderMetrics(trackData, mesh);
      }
      if (mesh && mesh.surfaceMap) {
        vehicleController.setSurfaceMap(mesh.surfaceMap);
      }
      // Reposition vehicle to start of circuit
      if (trackData.points.length > 1) {
        const p0 = trackData.points[0].position;
        const p1 = trackData.points[1].position;
        const tangentHeading = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        vehicleController.setStartPosition(new THREE.Vector3(p0.x, p0.y + 0.3, p0.z), tangentHeading);
      }
    },
    (selectedPoint) => {
      if (editorToolbar) {
        editorToolbar.updateSelection(selectedPoint);
      }
    }
  );

  // Initialize Storage Modal
  storageModal = new StorageModal(trackEditor, trackEditor.getStartFinishGate(), (serializedTrack) => {
    const { trackData, gateData } = TrackStorage.deserialize(serializedTrack);
    trackEditor.loadTrack(trackData, gateData);
  });

  // Initialize Car Select Modal
  carSelectModal = new CarSelectModal((selectedCarId) => {
    vehicleController.loadCarModel(selectedCarId, qualityManager.getSettings().tier);
  });

  // Set initial surface map
  const initialMesh = trackEditor.getGeneratedMesh();
  if (initialMesh && initialMesh.surfaceMap) {
    vehicleController.setSurfaceMap(initialMesh.surfaceMap);
    const points = trackEditor.getTrackData().points;
    if (points.length > 1) {
      const p0 = points[0].position;
      const p1 = points[1].position;
      const tangentHeading = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      vehicleController.setStartPosition(new THREE.Vector3(p0.x, p0.y + 0.3, p0.z), tangentHeading);
    }
  }

  // Initialize Editor Toolbar
  editorToolbar = new EditorToolbar(
    trackEditor,
    (isDrive) => {
      isDriveModeActive = isDrive;
      vehicleController.setVisible(true);
      if (isDrive) {
        trackEditor.setTopDown(false);
      }
    },
    () => {
      storageModal.open();
    },
    () => {
      carSelectModal.open();
    }
  );

  // Initialize Stats / FPS Overlay
  const statsOverlay = new StatsOverlay(initResult.backend, initResult.adapterInfo || 'Generic GPU');

  // Initialize Settings UI
  new SettingsUI(initResult.backend, (forcedBackend: RenderBackendType | null) => {
    rendererManager.setForcedBackend(forcedBackend);
    console.info(`[Bootstrap] Backend preference updated to: ${forcedBackend || 'Auto'}. Reloading pipeline...`);
    window.location.reload();
  });

  // Listen to quality changes and adapt renderer & scene live
  qualityManager.onQualityChange((newQuality) => {
    rendererManager.applyQuality(newQuality);
    appScene.applyQuality(newQuality);
    chaseCamera.far = newQuality.maxVisibleDrawDistance;
    chaseCamera.updateProjectionMatrix();
    vehicleController.loadCarModel(vehicleController.getCurrentCarId(), newQuality.tier);
  });

  // Resize Handling
  window.addEventListener('resize', () => {
    rendererManager.handleResize();
    appScene.handleResize();
    trackEditor.handleResize();
    chaseCamera.aspect = window.innerWidth / window.innerHeight;
    chaseCamera.updateProjectionMatrix();
  });

  // Main Render Loop
  let lastTimestamp = performance.now();

  function animate(currentTimestamp: number) {
    requestAnimationFrame(animate);

    const deltaSeconds = Math.min((currentTimestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = currentTimestamp;

    let activeCam: THREE.Camera;

    if (isDriveModeActive) {
      // 1. Step Rapier 3D Vehicle Physics at fixed 120Hz sub-steps
      const alpha = rapierWorldManager.stepFixedTimestep(deltaSeconds, (dt) => {
        vehicleController.stepPhysics(dt);
      });

      // 2. Interpolate Visual Transform and fetch telemetry
      const telemetry = vehicleController.updateVisuals(alpha);
      editorToolbar.updateDriveTelemetry(telemetry);

      // 3. Smooth Dynamic Chase Camera
      const carPos = vehicleController.getPosition();
      const carRot = vehicleController.getQuaternion();

      // Camera positioned behind (-Z) and above (+Y) chassis
      const cameraOffset = new THREE.Vector3(0, 3.2, -7.5).applyQuaternion(carRot);
      const targetCamPos = carPos.clone().add(cameraOffset);
      chaseCamera.position.lerp(targetCamPos, deltaSeconds * 9);

      // Camera look target slightly ahead of car
      const lookTarget = carPos.clone().add(new THREE.Vector3(0, 0.9, 3.5).applyQuaternion(carRot));
      chaseCamera.lookAt(lookTarget);

      activeCam = chaseCamera;
    } else {
      const isOrbitActive = !trackEditor.isTopDown();
      appScene.update(deltaSeconds, isOrbitActive);
      activeCam = trackEditor.getActiveCamera();
    }

    // Render current frame
    renderer.render(appScene.scene, activeCam);

    // Update telemetry & stats overlay
    statsOverlay.update(renderer, rendererManager.getActiveBackend(), rendererManager.getAdapterInfo());
  }

  requestAnimationFrame(animate);
  console.info(`%c[Antigravity GP] Phase C Multi-surface Track & Off-Track Detection Active!`, 'color: #00f2fe; font-weight: bold; font-size: 14px;');
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch(err => {
    console.error('[Antigravity GP] Fatal bootstrap error:', err);
  });
});
