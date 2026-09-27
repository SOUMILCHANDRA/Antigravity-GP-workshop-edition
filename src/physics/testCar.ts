import * as THREE from 'three';
import { SurfaceMap } from '../track/surfaceMap';
import { type WheelSurfaceContact } from '../track/surfaceTypes';
import type { SurfaceSampleResult } from '../track/types';
import { CAR_ROSTER, type CarSpecs } from '../cars/carData';
import { carModelLoader } from '../cars/carModelLoader';
import { QualityTier } from '../core/types';

export interface CarTelemetry {
  speedKmh: number;
  throttle: number;
  brake: number;
  steerAngleDeg: number;
  isOffTrack: boolean;
  offTrackWheelCount: number;
  wheelContacts: WheelSurfaceContact[];
  currentDragPenalty: number;
  carName: string;
}

export class TestCar {
  public group: THREE.Group;
  public position: THREE.Vector3 = new THREE.Vector3(0, 1, -40);
  public headingRad: number = 0; // Yaw angle (0 = along +X axis)
  public speedMs: number = 0;

  private currentCarId: string = 'mclaren_mp45';
  private currentSpecs: CarSpecs;
  private carVisualContainer: THREE.Group;
  private carModelGroup: THREE.Group | null = null;
  private wheelContactMarkers: THREE.Mesh[] = [];

  // Physical Dimensions (dynamically synced to active car)
  private wheelbase: number = 2.9;
  private trackWidth: number = 1.82;
  private maxSpeedMs: number = 95; // ~345 km/h
  private maxReverseSpeedMs: number = 18;
  private acceleration: number = 24; // m/s^2
  private braking: number = 34; // m/s^2
  private steerAngle: number = 0; // radians
  private maxSteerAngle: number = THREE.MathUtils.degToRad(32);

  // Input State
  private keys: Record<string, boolean> = {};

  // Surface Map
  private surfaceMap: SurfaceMap | null = null;
  private lastLoggedOffTrack: boolean = false;

  constructor(scene: THREE.Scene, initialCarId: string = 'mclaren_mp45', initialTier: QualityTier = QualityTier.High) {
    this.group = new THREE.Group();
    this.carVisualContainer = new THREE.Group();
    this.group.add(this.carVisualContainer);

    this.group.position.copy(this.position);
    this.currentCarId = initialCarId;
    this.currentSpecs = CAR_ROSTER[initialCarId] || CAR_ROSTER.mclaren_mp45;

    // Create 4 Wheel Contact ground markers
    const markerGeo = new THREE.RingGeometry(0.12, 0.28, 16);
    for (let i = 0; i < 4; i++) {
      const markerMat = new THREE.MeshBasicMaterial({
        color: 0x00f2fe,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
      });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(0, 0.02, 0);
      this.wheelContactMarkers.push(marker);
      this.group.add(marker);
    }

    scene.add(this.group);
    this.bindInputs();
    this.setCarModel(initialCarId, initialTier);
  }

  public async setCarModel(carId: string, tier: QualityTier): Promise<void> {
    const specs = CAR_ROSTER[carId];
    if (!specs) return;

    this.currentCarId = carId;
    this.currentSpecs = specs;

    // Sync physical parameters
    this.wheelbase = specs.wheelbaseMeters;
    this.trackWidth = (specs.frontTrackMeters + specs.rearTrackMeters) / 2;
    this.maxSpeedMs = specs.topSpeedKmh / 3.6;

    // Acceleration scaled by power-to-weight
    const hpPerTon = (specs.peakHorsepower / specs.massKg) * 1000;
    this.acceleration = (hpPerTon / 1000) * 18 + 8; // e.g. ~20 - 32 m/s^2

    // Load normalized 3D GLB model
    try {
      const loaded = await carModelLoader.loadCarModel(carId, tier);

      if (this.carModelGroup) {
        this.carVisualContainer.remove(this.carModelGroup);
      }

      this.carModelGroup = loaded.scene;
      // Align 3D model nose with chassis forward heading (+X)
      this.carModelGroup.position.set(0, 0, 0);
      this.carModelGroup.rotation.y = specs.modelRotationY ?? (Math.PI / 2);
      this.carVisualContainer.add(this.carModelGroup);

      // Reposition wheel contact markers to match this car's exact wheelbase & track width
      const halfL = this.wheelbase / 2;
      const halfW = this.trackWidth / 2;
      const wheelOffsets = [
        new THREE.Vector3(halfL, 0.02, -halfW),  // FL
        new THREE.Vector3(halfL, 0.02, halfW),   // FR
        new THREE.Vector3(-halfL, 0.02, -halfW), // RL
        new THREE.Vector3(-halfL, 0.02, halfW)   // RR
      ];

      wheelOffsets.forEach((pos, idx) => {
        if (this.wheelContactMarkers[idx]) {
          this.wheelContactMarkers[idx].position.copy(pos);
        }
      });

      console.info(`[TestCar] Mounted 3D model for ${specs.name} (LOD: ${tier}, Tris: ${loaded.triangleCount})`);
    } catch (e) {
      console.error('[TestCar] Error loading car model:', e);
    }
  }

  public setSurfaceMap(map: SurfaceMap | null): void {
    this.surfaceMap = map;
  }

  public setStartPosition(pos: THREE.Vector3, headingRad: number): void {
    this.position.copy(pos);
    this.headingRad = headingRad;
    this.speedMs = 0;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.headingRad;
  }

  private bindInputs(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }

  public update(deltaSeconds: number): CarTelemetry {
    const isAccelerating = this.keys['w'] || this.keys['arrowup'];
    const isBraking = this.keys['s'] || this.keys['arrowdown'];
    const isSteeringLeft = this.keys['a'] || this.keys['arrowleft'];
    const isSteeringRight = this.keys['d'] || this.keys['arrowright'];

    // 1. Steering input smoothing
    let targetSteer = 0;
    if (isSteeringLeft) targetSteer += this.maxSteerAngle;
    if (isSteeringRight) targetSteer -= this.maxSteerAngle;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, targetSteer, deltaSeconds * 10);

    // 2. Compute 4 Wheel World Contact Points
    const halfL = this.wheelbase / 2;
    const halfW = this.trackWidth / 2;
    const localOffsets = [
      new THREE.Vector3(halfL, 0, -halfW),  // FL
      new THREE.Vector3(halfL, 0, halfW),   // FR
      new THREE.Vector3(-halfL, 0, -halfW), // RL
      new THREE.Vector3(-halfL, 0, halfW)   // RR
    ];

    const wheelNames: Array<'FL' | 'FR' | 'RL' | 'RR'> = ['FL', 'FR', 'RL', 'RR'];
    const wheelContacts: WheelSurfaceContact[] = [];

    let totalDragMultiplier = 0;
    let totalDecelPenalty = 0;
    let avgFriction = 0;
    let offTrackCount = 0;
    let avgElevation = 0;

    localOffsets.forEach((offset, idx) => {
      const worldPos = offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.headingRad).add(this.position);

      let surfaceResult: SurfaceSampleResult = {
        surface: {
          type: 'offtrack',
          name: 'Off-Track',
          frictionMultiplier: 0.35,
          rollingDragMultiplier: 3.8,
          decelerationPenalty: 10.0,
          isDrivable: false,
          colorHex: 0x18281a
        },
        elevation: 0,
        normal: new THREE.Vector3(0, 1, 0),
        distanceToCenterline: 999,
        trackWidthAtPoint: 12,
        isInsideTrackBounds: false
      };

      if (this.surfaceMap) {
        surfaceResult = this.surfaceMap.sampleSurface(worldPos.x, worldPos.z);
      }

      const isOff = !surfaceResult.surface.isDrivable;
      if (isOff) offTrackCount++;

      totalDragMultiplier += surfaceResult.surface.rollingDragMultiplier;
      totalDecelPenalty += surfaceResult.surface.decelerationPenalty;
      avgFriction += surfaceResult.surface.frictionMultiplier;
      avgElevation += surfaceResult.elevation;

      wheelContacts.push({
        wheelIndex: idx,
        wheelName: wheelNames[idx],
        worldPosition: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        surface: surfaceResult.surface,
        isOffTrack: isOff
      });

      // Update wheel marker color
      if (this.wheelContactMarkers[idx]) {
        const mat = this.wheelContactMarkers[idx].material as THREE.MeshBasicMaterial;
        mat.color.setHex(surfaceResult.surface.colorHex);
      }
    });

    totalDragMultiplier /= 4;
    totalDecelPenalty /= 4;
    avgFriction /= 4;
    avgElevation /= 4;

    // 3. Longitudinal Dynamics
    if (isAccelerating) {
      this.speedMs += this.acceleration * avgFriction * deltaSeconds;
    }
    if (isBraking) {
      if (this.speedMs > 0.2) {
        this.speedMs -= this.braking * avgFriction * deltaSeconds;
      } else {
        this.speedMs -= this.acceleration * 0.5 * deltaSeconds;
      }
    }

    // Natural drag & rolling resistance + Heavy Gravel Drag Penalty
    const airDrag = 0.0018 * this.currentSpecs.dragCoefficient * this.speedMs * this.speedMs;
    const rollingResistance = 1.2 * totalDragMultiplier;
    const dragForce = (airDrag + rollingResistance + totalDecelPenalty) * Math.sign(this.speedMs);

    if (Math.abs(this.speedMs) > 0.05) {
      this.speedMs -= dragForce * deltaSeconds;
    } else if (!isAccelerating && !isBraking) {
      this.speedMs = 0;
    }

    this.speedMs = Math.max(-this.maxReverseSpeedMs, Math.min(this.maxSpeedMs, this.speedMs));

    // 4. Lateral Dynamics
    if (Math.abs(this.speedMs) > 0.1) {
      const yawRate = (this.speedMs / this.wheelbase) * Math.tan(this.steerAngle) * avgFriction;
      this.headingRad += yawRate * deltaSeconds;
    }

    // 5. Integrate World Position
    const forwardX = Math.cos(this.headingRad);
    const forwardZ = -Math.sin(this.headingRad);

    this.position.x += forwardX * this.speedMs * deltaSeconds;
    this.position.z += forwardZ * this.speedMs * deltaSeconds;
    this.position.y = THREE.MathUtils.lerp(this.position.y, avgElevation, deltaSeconds * 12);

    this.group.position.copy(this.position);
    this.group.rotation.y = this.headingRad;

    // Chassis body roll & pitch under acceleration/braking and cornering
    const lateralG = (this.speedMs * this.speedMs * Math.tan(this.steerAngle)) / (this.wheelbase * 9.81);
    const accelG = isAccelerating ? -0.05 : isBraking ? 0.08 : 0;
    this.carVisualContainer.rotation.x = THREE.MathUtils.lerp(this.carVisualContainer.rotation.x, -lateralG * 0.05, deltaSeconds * 8);
    this.carVisualContainer.rotation.z = THREE.MathUtils.lerp(this.carVisualContainer.rotation.z, accelG, deltaSeconds * 8);

    const isOffTrackOverall = offTrackCount >= 2;

    if (isOffTrackOverall !== this.lastLoggedOffTrack) {
      this.lastLoggedOffTrack = isOffTrackOverall;
      if (isOffTrackOverall) {
        console.warn(`[Off-Track Alert] Vehicle off-track! (${wheelContacts[0].surface.name})`);
      } else {
        console.info(`[On-Track] Vehicle returned to track surface`);
      }
    }

    return {
      speedKmh: Math.abs(this.speedMs * 3.6),
      throttle: isAccelerating ? 1 : 0,
      brake: isBraking ? 1 : 0,
      steerAngleDeg: THREE.MathUtils.radToDeg(this.steerAngle),
      isOffTrack: isOffTrackOverall,
      offTrackWheelCount: offTrackCount,
      wheelContacts,
      currentDragPenalty: totalDecelPenalty,
      carName: this.currentSpecs.name
    };
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public getCurrentCarSpecs(): CarSpecs {
    return this.currentSpecs;
  }

  public getCurrentCarId(): string {
    return this.currentCarId;
  }
}
