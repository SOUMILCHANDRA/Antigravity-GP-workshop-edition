import * as THREE from 'three';
import { type VehicleController } from '../physics/vehicleController';
import { type VehicleTelemetry } from '../physics/vehiclePhysics';
import { type TrackSplineSample } from '../track/types';

export type CameraMode = 'chase' | 'cockpit' | 'hood' | 'trackside';

export class CameraSystem {
  private camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'chase';
  private modeList: CameraMode[] = ['chase', 'cockpit', 'hood', 'trackside'];
  private currentModeIndex: number = 0;

  // Spring Arm & Smoothing
  private currentCameraPos: THREE.Vector3 = new THREE.Vector3();
  private currentLookTarget: THREE.Vector3 = new THREE.Vector3();
  private baseFov: number = 60;
  private targetFov: number = 60;

  // Camera Shake / Surface Vibration
  private shakeOffset: THREE.Vector3 = new THREE.Vector3();
  private shakeTrauma: number = 0;
  private shakeTime: number = 0;

  // Trackside TV Camera placement
  private trackSplineSamples: TrackSplineSample[] = [];
  private currentTvCameraIndex: number = 0;
  private tvCameraPositions: THREE.Vector3[] = [];

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.baseFov = camera.fov;
    this.currentCameraPos.copy(camera.position);

    // Bind 'C' key to cycle cameras
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'c') {
        this.cycleCamera();
      }
    });
  }

  public setTrackSamples(samples: TrackSplineSample[]): void {
    this.trackSplineSamples = samples;
    this.setupTvCameras();
  }

  private setupTvCameras(): void {
    if (this.trackSplineSamples.length === 0) return;
    this.tvCameraPositions = [];
    const step = Math.max(10, Math.floor(this.trackSplineSamples.length / 12));

    for (let i = 0; i < this.trackSplineSamples.length; i += step) {
      const s = this.trackSplineSamples[i];
      // Position TV camera 16m off to the side and 4.5m elevated
      const offset = s.binormal.clone().multiplyScalar(s.width * 0.5 + 16);
      const camPos = s.position.clone().add(offset).add(new THREE.Vector3(0, 4.5, 0));
      this.tvCameraPositions.push(camPos);
    }
  }

  public cycleCamera(): CameraMode {
    this.currentModeIndex = (this.currentModeIndex + 1) % this.modeList.length;
    this.mode = this.modeList[this.currentModeIndex];
    console.info(`[CameraSystem] Switched camera view to: ${this.mode.toUpperCase()}`);
    return this.mode;
  }

  public setMode(mode: CameraMode): void {
    this.mode = mode;
    this.currentModeIndex = Math.max(0, this.modeList.indexOf(mode));
  }

  public getMode(): CameraMode {
    return this.mode;
  }

  public snapToVehicle(vehicle: VehicleController): void {
    const carPos = vehicle.getPosition();
    const carRot = vehicle.getQuaternion();

    if (this.mode === 'chase') {
      const offset = new THREE.Vector3(0, 3.2, -7.5).applyQuaternion(carRot);
      this.currentCameraPos.copy(carPos.clone().add(offset));
      const lookTarget = carPos.clone().add(new THREE.Vector3(0, 0.9, 3.5).applyQuaternion(carRot));
      this.currentLookTarget.copy(lookTarget);
    } else if (this.mode === 'cockpit') {
      const eyeOffset = new THREE.Vector3(0, 0.72, -0.25).applyQuaternion(carRot);
      this.currentCameraPos.copy(carPos.clone().add(eyeOffset));
      const lookTarget = carPos.clone().add(new THREE.Vector3(0, 0.68, 12).applyQuaternion(carRot));
      this.currentLookTarget.copy(lookTarget);
    } else if (this.mode === 'hood') {
      const noseOffset = new THREE.Vector3(0, 0.45, 1.8).applyQuaternion(carRot);
      this.currentCameraPos.copy(carPos.clone().add(noseOffset));
      const lookTarget = carPos.clone().add(new THREE.Vector3(0, 0.40, 15).applyQuaternion(carRot));
      this.currentLookTarget.copy(lookTarget);
    }

    this.camera.position.copy(this.currentCameraPos);
    this.camera.lookAt(this.currentLookTarget);
  }

  public update(deltaSeconds: number, vehicle: VehicleController, telemetry: VehicleTelemetry): void {
    const carPos = vehicle.getPosition();
    const carRot = vehicle.getQuaternion();
    const speedKmh = telemetry.speedKmh;

    // 1. Dynamic Speed FOV Kick (60 deg at 0 km/h -> 74 deg at 300+ km/h)
    const speedRatio = Math.min(1.0, speedKmh / 320);
    this.targetFov = this.baseFov + speedRatio * 14;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFov, deltaSeconds * 6);
    this.camera.updateProjectionMatrix();

    // 2. Surface-Dependent Camera Vibration & Trauma
    this.shakeTime += deltaSeconds * 40;
    let targetTrauma = 0;

    // Road surface vibration
    if (telemetry.wheelStates.some(w => w.surfaceResult.surface.type === 'gravel')) {
      targetTrauma = 0.85; // Heavy violent gravel rumble
    } else if (telemetry.wheelStates.some(w => w.surfaceResult.surface.type === 'kerb')) {
      targetTrauma = 0.45; // Staccato kerb bump frequency
    } else if (speedKmh > 120) {
      targetTrauma = (speedKmh / 350) * 0.18; // High speed asphalt chatter
    }

    this.shakeTrauma = THREE.MathUtils.lerp(this.shakeTrauma, targetTrauma, deltaSeconds * 12);
    const shakeIntensity = this.shakeTrauma * this.shakeTrauma * 0.08;

    this.shakeOffset.set(
      (Math.sin(this.shakeTime * 1.3) + Math.cos(this.shakeTime * 2.7)) * shakeIntensity,
      (Math.cos(this.shakeTime * 1.9) + Math.sin(this.shakeTime * 3.1)) * shakeIntensity,
      (Math.sin(this.shakeTime * 2.1)) * shakeIntensity * 0.5
    );

    // 3. Camera Position and Look Target per Mode
    switch (this.mode) {
      case 'chase': {
        // Trailing spring-arm behind and above with dynamic lag
        const lagOffsetZ = -7.2 - speedRatio * 1.4;
        const cameraLocalOffset = new THREE.Vector3(
          -telemetry.gForceLat * 0.35, // subtle outward drift under lateral G
          3.0 - telemetry.gForceLong * 0.2, // dips on acceleration, raises on braking
          lagOffsetZ
        );

        const targetPos = carPos.clone().add(cameraLocalOffset.applyQuaternion(carRot));
        const lerpSpeed = Math.min(1.0, deltaSeconds * 12);
        this.currentCameraPos.lerp(targetPos, lerpSpeed);

        const targetLook = carPos.clone().add(new THREE.Vector3(0, 0.85, 3.8).applyQuaternion(carRot));
        this.currentLookTarget.lerp(targetLook, deltaSeconds * 16);
        break;
      }

      case 'cockpit': {
        // Driver POV inside chassis with head tilt
        const headLookOffset = new THREE.Vector3(
          telemetry.gForceLat * 0.08, // look into the corner
          0.72 - telemetry.gForceLong * 0.04,
          -0.20
        );

        const eyePos = carPos.clone().add(headLookOffset.applyQuaternion(carRot));
        this.currentCameraPos.copy(eyePos);

        const forwardLook = new THREE.Vector3(0, 0.68, 14).applyQuaternion(carRot);
        this.currentLookTarget.copy(carPos.clone().add(forwardLook));
        break;
      }

      case 'hood': {
        // Front wing nose camera right on the road
        const nosePos = carPos.clone().add(new THREE.Vector3(0, 0.42, 1.85).applyQuaternion(carRot));
        this.currentCameraPos.copy(nosePos);

        const noseLook = carPos.clone().add(new THREE.Vector3(0, 0.38, 18).applyQuaternion(carRot));
        this.currentLookTarget.copy(noseLook);
        break;
      }

      case 'trackside': {
        // Find nearest TV camera tower ahead of the car
        if (this.tvCameraPositions.length > 0) {
          let bestIdx = 0;
          let bestDistSq = Infinity;

          for (let i = 0; i < this.tvCameraPositions.length; i++) {
            const camPos = this.tvCameraPositions[i];
            const dSq = camPos.distanceToSquared(carPos);
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              bestIdx = i;
            }
          }

          // Switch tower when car passes
          this.currentTvCameraIndex = bestIdx;
          const activeTvPos = this.tvCameraPositions[this.currentTvCameraIndex];
          this.currentCameraPos.lerp(activeTvPos, deltaSeconds * 8);

          // Track car center
          this.currentLookTarget.lerp(carPos.clone().add(new THREE.Vector3(0, 0.6, 0)), deltaSeconds * 20);
        }
        break;
      }
    }

    // Apply Position + Shake
    this.camera.position.copy(this.currentCameraPos).add(this.shakeOffset);
    this.camera.lookAt(this.currentLookTarget);
  }
}
