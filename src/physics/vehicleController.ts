import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_ROSTER, type CarSpecs } from '../cars/carData';
import { carModelLoader } from '../cars/carModelLoader';
import { QualityTier } from '../core/types';
import { type SurfaceMap } from '../track/surfaceMap';
import { VehiclePhysics, type VehicleTelemetry, type WheelState } from './vehiclePhysics';

export class VehicleController {
  private scene: THREE.Scene;
  private physics: VehiclePhysics;
  private currentCarId: string;
  private currentSpecs: CarSpecs;
  private currentTier: QualityTier;

  // 3D Visual Scene Nodes
  public group: THREE.Group;
  private carVisualContainer: THREE.Group;
  private carModelGroup: THREE.Group | null = null;
  private wheelContactMarkers: THREE.Mesh[] = [];

  // Inputs
  private keys: Record<string, boolean> = {};

  // Wheel Visual Meshes (if isolated) or Dynamic Markers
  private wheelOffsets: THREE.Vector3[] = [];

  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    initialCarId: string = 'mclaren_mp45',
    initialTier: QualityTier = QualityTier.High,
    initialPosition: THREE.Vector3 = new THREE.Vector3(0, 1, -40),
    initialHeadingRad: number = 0
  ) {
    this.scene = scene;
    this.currentCarId = initialCarId;
    this.currentSpecs = CAR_ROSTER[initialCarId] || CAR_ROSTER.mclaren_mp45;
    this.currentTier = initialTier;

    // Visual Root Group
    this.group = new THREE.Group();
    this.carVisualContainer = new THREE.Group();
    this.group.add(this.carVisualContainer);

    // Initialize Vehicle Physics
    this.physics = new VehiclePhysics(world, this.currentSpecs, initialPosition, initialHeadingRad);

    // Create 4 Wheel Contact Ground Markers
    const markerGeo = new THREE.RingGeometry(0.14, 0.30, 20);
    for (let i = 0; i < 4; i++) {
      const markerMat = new THREE.MeshBasicMaterial({
        color: 0x00f2fe,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(0, 0.02, 0);
      this.wheelContactMarkers.push(marker);
      this.group.add(marker);
    }

    this.scene.add(this.group);
    this.bindInputs();
    this.loadCarModel(this.currentCarId, this.currentTier);
  }

  public async loadCarModel(carId: string, tier: QualityTier): Promise<void> {
    const specs = CAR_ROSTER[carId];
    if (!specs) return;

    this.currentCarId = carId;
    this.currentSpecs = specs;
    this.currentTier = tier;
    this.physics.setSpecs(specs);

    try {
      const loaded = await carModelLoader.loadCarModel(carId, tier);

      if (this.carModelGroup) {
        this.carVisualContainer.remove(this.carModelGroup);
      }

      this.carModelGroup = loaded.scene;
      this.carModelGroup.position.set(0, 0, 0);
      // Align model forward (+Z)
      this.carModelGroup.rotation.y = specs.modelRotationY ?? 0;
      this.carVisualContainer.add(this.carModelGroup);

      // Reposition Wheel Markers
      const halfL = specs.wheelbaseMeters / 2;
      const halfWFront = specs.frontTrackMeters / 2;
      const halfWRear = specs.rearTrackMeters / 2;

      this.wheelOffsets = [
        new THREE.Vector3(-halfWFront, 0.02, halfL),  // FL
        new THREE.Vector3(halfWFront, 0.02, halfL),   // FR
        new THREE.Vector3(-halfWRear, 0.02, -halfL),  // RL
        new THREE.Vector3(halfWRear, 0.02, -halfL)   // RR
      ];

      this.wheelOffsets.forEach((pos, idx) => {
        if (this.wheelContactMarkers[idx]) {
          this.wheelContactMarkers[idx].position.copy(pos);
        }
      });

      console.info(`[VehicleController] Loaded ${specs.name} (${tier}) - Ready to race`);
    } catch (err) {
      console.error('[VehicleController] Failed to load car model:', err);
    }
  }

  public setSurfaceMap(map: SurfaceMap | null): void {
    this.physics.setSurfaceMap(map);
  }

  public setStartPosition(pos: THREE.Vector3, headingRad: number): void {
    this.physics.teleport(pos, headingRad);
    this.group.position.copy(pos);
    this.group.rotation.y = headingRad;
  }

  private bindInputs(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }

  /**
   * Called during each fixed 120Hz physics sub-step
   */
  public stepPhysics(dt: number): void {
    const isThrottle = this.keys['w'] || this.keys['arrowup'] ? 1 : 0;
    const isBrake = this.keys['s'] || this.keys['arrowdown'] ? 1 : 0;

    let steer = 0;
    if (this.keys['a'] || this.keys['arrowleft']) steer -= 1;
    if (this.keys['d'] || this.keys['arrowright']) steer += 1;

    this.physics.setInputs(isThrottle, isBrake, steer);
    this.physics.stepSubstep(dt);
  }

  /**
   * Called during render frame (60-144 FPS) with interpolation alpha
   */
  public updateVisuals(alpha: number): VehicleTelemetry {
    const { position, rotation } = this.physics.getInterpolatedTransform(alpha);

    // Apply smooth interpolated transform to Visual Root Group
    this.group.position.copy(position);
    this.group.quaternion.copy(rotation);

    const telemetry = this.physics.getTelemetry();

    // Visual Chassis Pitch & Roll from G-Forces
    const rollAngle = -telemetry.gForceLat * 0.035;
    const pitchAngle = telemetry.gForceLong * 0.035;

    this.carVisualContainer.rotation.z = THREE.MathUtils.lerp(this.carVisualContainer.rotation.z, rollAngle, 0.2);
    this.carVisualContainer.rotation.x = THREE.MathUtils.lerp(this.carVisualContainer.rotation.x, pitchAngle, 0.2);

    // Update Wheel Contact Markers (color and ground position)
    telemetry.wheelStates.forEach((wheel: WheelState, idx: number) => {
      if (this.wheelContactMarkers[idx]) {
        const marker = this.wheelContactMarkers[idx];
        const mat = marker.material as THREE.MeshBasicMaterial;

        // Change color according to surface type and slip
        if (wheel.isGrounded) {
          mat.color.setHex(wheel.surfaceResult.surface.colorHex);
          mat.opacity = wheel.tireForce.gripFraction < 0.75 ? 1.0 : 0.7;
        } else {
          mat.color.setHex(0x555555);
          mat.opacity = 0.2;
        }
      }
    });

    return telemetry;
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public getPosition(): THREE.Vector3 {
    return this.group.position;
  }

  public getQuaternion(): THREE.Quaternion {
    return this.group.quaternion;
  }

  public getPhysics(): VehiclePhysics {
    return this.physics;
  }

  public getCurrentCarSpecs(): CarSpecs {
    return this.currentSpecs;
  }

  public getCurrentCarId(): string {
    return this.currentCarId;
  }
}
