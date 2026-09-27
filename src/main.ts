import './style.css';
import * as THREE from 'three';
import { qualityManager } from './core/quality';
import { RendererManager } from './graphics/renderer';
import { AppScene } from './graphics/scene';
import { CameraSystem } from './graphics/cameraSystem';
import { TrackEditor } from './editor/trackEditor';
import { EditorToolbar } from './ui/editorToolbar';
import { StorageModal } from './ui/storageModal';
import { CarSelectModal } from './ui/carSelectModal';
import { TrackStorage } from './track/trackStorage';
import { StatsOverlay } from './ui/statsOverlay';
import { SettingsUI } from './ui/settingsUI';
import { rapierWorldManager } from './physics/rapierWorld';
import { VehicleController } from './physics/vehicleController';
import { LapTimer } from './racing/lapTimer';
import { AIGridManager } from './racing/aiGridManager';
import { WeatherManager, type WeatherPreset } from './environment/weatherManager';
import { SlipstreamSystem } from './racing/slipstream';
import { AudioEngine } from './audio/audioEngine';
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

  // Initialize Scene, Lighting, Shadows
  const appScene = new AppScene(canvas, quality);

  // Initialize Weather & Dynamic Lighting (Phase J & K)
  const weatherManager = new WeatherManager(appScene);
  const weatherPresets: WeatherPreset[] = ['clear_noon', 'sunset', 'night', 'overcast_rain'];
  let activeWeatherIndex = 0;

  // Initialize Rapier 3D WASM Physics World (Phase F)
  const physicsWorld = await rapierWorldManager.init();

  // Chase / Multi-mode Camera for Test Drive Mode (Phase G)
  const chaseCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, quality.maxVisibleDrawDistance);
  chaseCamera.position.set(0, 5, -10);
  const cameraSystem = new CameraSystem(chaseCamera);

  // Initialize Core Vehicle Controller with Rapier 4-Wheel Physics (Phase F)
  const vehicleController = new VehicleController(appScene.scene, physicsWorld);
  let isDriveModeActive = false;

  // Initialize Lap Timing & Ghost Car System (Phase H)
  const lapTimer = new LapTimer(appScene.scene);

  // Initialize AI Grid Manager (Phase I)
  const aiGridManager = new AIGridManager(appScene.scene);

  // Initialize Slipstream System (Phase L)
  const slipstreamSystem = new SlipstreamSystem(appScene.scene);

  // Initialize Procedural Audio Engine (Phase N)
  const audioEngine = new AudioEngine();
  audioEngine.setCarSpecs(vehicleController.getCurrentCarSpecs());

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
      if (mesh) {
        if (mesh.surfaceMap) {
          vehicleController.setSurfaceMap(mesh.surfaceMap);
        }
        cameraSystem.setTrackSamples(mesh.samples);
        lapTimer.setTrackSpline(mesh.samples);
        aiGridManager.setupGrid(mesh.samples, mesh.surfaceMap, 4, quality.tier);
      }
      // Reposition vehicle to start of circuit
      if (trackData.points.length > 1) {
        const p0 = trackData.points[0].position;
        const p1 = trackData.points[1].position;
        const tangentHeading = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        vehicleController.setStartPosition(new THREE.Vector3(p0.x, p0.y, p0.z), tangentHeading);
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
    audioEngine.setCarSpecs(vehicleController.getCurrentCarSpecs());
  });

  const resetCarToStart = (snapCamera: boolean = true) => {
    const trackData = trackEditor.getTrackData();
    const mesh = trackEditor.getGeneratedMesh();
    if (mesh && mesh.surfaceMap) {
      vehicleController.setSurfaceMap(mesh.surfaceMap);
    }
    if (trackData.points.length > 1) {
      const p0 = trackData.points[0].position;
      const p1 = trackData.points[1].position;
      const tangentHeading = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      vehicleController.setStartPosition(new THREE.Vector3(p0.x, p0.y, p0.z), tangentHeading);

      if (mesh) {
        cameraSystem.setTrackSamples(mesh.samples);
        lapTimer.setTrackSpline(mesh.samples);
        aiGridManager.setupGrid(mesh.samples, mesh.surfaceMap, 4, quality.tier);
        aiGridManager.startRace();
      }

      lapTimer.reset();

      if (snapCamera) {
        cameraSystem.snapToVehicle(vehicleController);
      }
    }
  };

  // Set initial surface map and samples
  const initialMesh = trackEditor.getGeneratedMesh();
  if (initialMesh) {
    if (initialMesh.surfaceMap) {
      vehicleController.setSurfaceMap(initialMesh.surfaceMap);
    }
    cameraSystem.setTrackSamples(initialMesh.samples);
    lapTimer.setTrackSpline(initialMesh.samples);
    aiGridManager.setupGrid(initialMesh.samples, initialMesh.surfaceMap, 4, quality.tier);
  }
  resetCarToStart(false);

  // Initialize Editor Toolbar
  editorToolbar = new EditorToolbar(
    trackEditor,
    (isDrive) => {
      isDriveModeActive = isDrive;
      vehicleController.setVisible(true);
      if (isDrive) {
        trackEditor.setTopDown(false);
        resetCarToStart(true);
      }
    },
    () => {
      storageModal.open();
    },
    () => {
      carSelectModal.open();
    },
    () => {
      const nextCam = cameraSystem.cycleCamera();
      editorToolbar.setCameraName(nextCam);
    },
    () => {
      activeWeatherIndex = (activeWeatherIndex + 1) % weatherPresets.length;
      const preset = weatherPresets[activeWeatherIndex];
      weatherManager.applyPreset(preset);
      editorToolbar.setWeatherName(preset.replace(/_/g, ' '));
    }
  );

  // Bind 'R' key to reset car during test drive
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r' && isDriveModeActive) {
      resetCarToStart(true);
    }
  });

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

      // 3. Update AI Grid Racers (Phase I)
      aiGridManager.update(deltaSeconds, vehicleController);

      // 4. Update Slipstream Drafting (Phase L)
      const slipstream = slipstreamSystem.update(vehicleController, aiGridManager.getAiRacers(), deltaSeconds);

      // 5. Update Lap Timer & Ghost Car (Phase H)
      lapTimer.update(deltaSeconds, vehicleController, telemetry);

      // 6. Update Procedural Audio Engine (Phase N)
      audioEngine.update(telemetry, isDriveModeActive);

      // 7. Update Dynamic Camera System (Phase G)
      cameraSystem.update(deltaSeconds, vehicleController, telemetry);

      // 8. Update Weather (Rain particles) (Phase J & K)
      weatherManager.update(deltaSeconds, chaseCamera.position);

      // 9. Update Drive HUD
      editorToolbar.updateDriveTelemetry(telemetry, lapTimer, slipstream);

      activeCam = chaseCamera;
    } else {
      const isOrbitActive = !trackEditor.isTopDown();
      appScene.update(deltaSeconds, isOrbitActive);
      activeCam = trackEditor.getActiveCamera();
      audioEngine.update(vehicleController.getPhysics().getTelemetry(), false);
    }

    // Render current frame
    renderer.render(appScene.scene, activeCam);

    // Update telemetry & stats overlay
    statsOverlay.update(renderer, rendererManager.getActiveBackend(), rendererManager.getAdapterInfo());
  }

  requestAnimationFrame(animate);
  console.info(`%c[Antigravity GP] All Championship Phases A through O Live & Operational!`, 'color: #00f2fe; font-weight: bold; font-size: 14px;');
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error during engine startup:', err);
});
