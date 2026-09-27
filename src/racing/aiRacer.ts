import * as THREE from 'three';
import { CAR_ROSTER, type CarSpecs } from '../cars/carData';
import { carModelLoader } from '../cars/carModelLoader';
import { QualityTier } from '../core/types';
import { type TrackSplineSample } from '../track/types';
import { type SurfaceMap } from '../track/surfaceMap';

export interface AIRacerConfig {
  id: string;
  name: string;
  driverName: string;
  carId: string;
  skillLevel: number; // 0.8 (Rookie) .. 1.0 (Pro) .. 1.2 (Alien)
  gridPosition: number;
}

export class AIRacer {
  public config: AIRacerConfig;
  public group: THREE.Group;
  public position: THREE.Vector3 = new THREE.Vector3();
  public headingRad: number = 0;
  public speedMs: number = 0;
  public currentLap: number = 1;
  public trackProgressDistance: number = 0;

  private specs: CarSpecs;
  private carModelGroup: THREE.Group | null = null;
  private trackSamples: TrackSplineSample[] = [];
  private surfaceMap: SurfaceMap | null = null;

  // Pure Pursuit Navigation
  private currentSplineIndex: number = 0;
  private lookaheadDistance: number = 18;
  private lateralOffsetTarget: number = 0; // -1 (left) .. +1 (right) for overtakes

  constructor(scene: THREE.Scene, config: AIRacerConfig, tier: QualityTier = QualityTier.High) {
    this.config = config;
    this.specs = CAR_ROSTER[config.carId] || CAR_ROSTER.ferrari_312;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.loadModel(tier);
  }

  public async loadModel(tier: QualityTier): Promise<void> {
    try {
      const loaded = await carModelLoader.loadCarModel(this.config.carId, tier);
      if (this.carModelGroup) {
        this.group.remove(this.carModelGroup);
      }
      this.carModelGroup = loaded.scene.clone(true);
      this.carModelGroup.rotation.y = this.specs.modelRotationY ?? 0;
      this.group.add(this.carModelGroup);
    } catch (err) {
      console.error('[AIRacer] Failed to load car model:', err);
    }
  }

  public setTrackSamples(samples: TrackSplineSample[], surfaceMap: SurfaceMap | null): void {
    this.trackSamples = samples;
    this.surfaceMap = surfaceMap;
  }

  public setGridSpawn(gridIndex: number): void {
    if (this.trackSamples.length === 0) return;

    // Stagger grid boxes (left/right alternating, 9m behind start per row)
    const isLeftRow = gridIndex % 2 === 0;
    const row = Math.floor(gridIndex / 2);
    const backDistance = (row + 1) * 9.0;

    const sample0 = this.trackSamples[0];
    const tangent = sample0.tangent.clone().normalize();
    const binormal = sample0.binormal.clone().normalize();

    const lateralOffset = isLeftRow ? -3.0 : 3.0;
    const spawnPos = sample0.position.clone()
      .addScaledVector(tangent, -backDistance)
      .addScaledVector(binormal, lateralOffset);

    this.position.copy(spawnPos);
    this.headingRad = Math.atan2(tangent.x, tangent.z);
    this.speedMs = 0;
    this.currentSplineIndex = 0;

    this.group.position.copy(this.position);
    this.group.rotation.y = this.headingRad;
  }

  public update(deltaSeconds: number, allCarsPositions: THREE.Vector3[]): void {
    if (this.trackSamples.length < 2) return;

    const n = this.trackSamples.length;

    // 1. Advance along spline
    let closestDistSq = Infinity;
    for (let i = 0; i < 20; i++) {
      const checkIdx = (this.currentSplineIndex + i) % n;
      const dSq = this.position.distanceToSquared(this.trackSamples[checkIdx].position);
      if (dSq < closestDistSq) {
        closestDistSq = dSq;
        this.currentSplineIndex = checkIdx;
      }
    }

    // 2. Pure Pursuit Target along centerline with lateral offset
    let targetIdx = this.currentSplineIndex;
    let accumulatedDist = 0;

    while (accumulatedDist < this.lookaheadDistance && targetIdx < this.currentSplineIndex + 40) {
      targetIdx = (targetIdx + 1) % n;
      const prev = this.trackSamples[(targetIdx - 1 + n) % n];
      accumulatedDist += prev.position.distanceTo(this.trackSamples[targetIdx].position);
    }

    const targetSample = this.trackSamples[targetIdx];
    const targetPoint = targetSample.position.clone()
      .addScaledVector(targetSample.binormal, this.lateralOffsetTarget * (targetSample.width * 0.35));

    // 3. Steering toward target point
    const toTarget = targetPoint.clone().sub(this.position);
    const desiredHeading = Math.atan2(toTarget.x, toTarget.z);

    let angleDiff = desiredHeading - this.headingRad;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const turnRate = 4.5 * this.config.skillLevel;
    this.headingRad += Math.max(-turnRate * deltaSeconds, Math.min(turnRate * deltaSeconds, angleDiff));

    // 4. Speed Profiling & Corner Braking
    // Calculate curvature ahead
    const curvatureSample = this.trackSamples[(this.currentSplineIndex + 8) % n];
    const curveTangent = curvatureSample.tangent;
    const currentTangent = this.trackSamples[this.currentSplineIndex].tangent;
    const turnSeverity = Math.abs(curveTangent.angleTo(currentTangent));

    const maxSpeedForCorner = Math.max(18, (this.specs.topSpeedKmh / 3.6) * (1.0 - turnSeverity * 1.8));
    const targetSpeed = maxSpeedForCorner * this.config.skillLevel;

    // 5. Collision Avoidance with other cars
    for (const otherPos of allCarsPositions) {
      if (otherPos === this.position) continue;
      const dToOther = this.position.distanceTo(otherPos);
      if (dToOther < 8.0) {
        const toOther = otherPos.clone().sub(this.position);
        const forwardDot = toOther.dot(new THREE.Vector3(Math.sin(this.headingRad), 0, Math.cos(this.headingRad)));
        if (forwardDot > 0) {
          // Car ahead! Decelerate and steer around
          this.speedMs *= 0.95;
          this.lateralOffsetTarget = toOther.x > 0 ? -0.7 : 0.7;
        }
      }
    }

    // Accelerate / Brake
    if (this.speedMs < targetSpeed) {
      this.speedMs += 14.0 * deltaSeconds;
    } else {
      this.speedMs -= 22.0 * deltaSeconds;
    }

    // Integrate Position
    const moveX = Math.sin(this.headingRad) * this.speedMs * deltaSeconds;
    const moveZ = Math.cos(this.headingRad) * this.speedMs * deltaSeconds;

    this.position.x += moveX;
    this.position.z += moveZ;

    // Surface Elevation
    if (this.surfaceMap) {
      const surfaceRes = this.surfaceMap.sampleSurface(this.position.x, this.position.z);
      this.position.y = surfaceRes.elevation;
    }

    this.group.position.copy(this.position);
    this.group.rotation.y = this.headingRad;
  }
}
