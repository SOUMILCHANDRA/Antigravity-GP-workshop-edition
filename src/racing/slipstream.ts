import * as THREE from 'three';
import { type VehicleController } from '../physics/vehicleController';
import { type AIRacer } from './aiRacer';

export interface SlipstreamState {
  inSlipstream: boolean;
  intensity: number; // 0..1
  leaderCarName?: string;
  dragReductionPercent: number;
}

export class SlipstreamSystem {
  private trailsMesh: THREE.LineSegments | null = null;
  private maxDistance: number = 30; // 30m slipstream wake cone

  constructor(scene: THREE.Scene) {
    this.createSpeedTrails(scene);
  }

  private createSpeedTrails(scene: THREE.Scene): void {
    const lineGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(40 * 6); // 40 streak lines
    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending
    });

    this.trailsMesh = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(this.trailsMesh);
  }

  public update(playerVehicle: VehicleController, aiRacers: AIRacer[], _dt: number): SlipstreamState {
    const playerPos = playerVehicle.getPosition();
    const playerRot = playerVehicle.getQuaternion();
    const playerFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(playerRot);

    let closestDist = Infinity;
    let closestLeaderName: string | undefined = undefined;

    for (const ai of aiRacers) {
      const toAI = ai.position.clone().sub(playerPos);
      const dist = toAI.length();

      if (dist < this.maxDistance) {
        const dot = toAI.clone().normalize().dot(playerFwd);
        // Car must be directly ahead (dot > 0.88 (~30 degree cone))
        if (dot > 0.88 && dist < closestDist) {
          closestDist = dist;
          closestLeaderName = ai.config.driverName;
        }
      }
    }

    const inSlipstream = closestDist < this.maxDistance;
    const intensity = inSlipstream ? Math.max(0, 1.0 - (closestDist / this.maxDistance)) : 0;
    const dragReduction = intensity * 28; // up to 28% less aero drag

    // Update Speed Wind Streaks
    if (this.trailsMesh) {
      const mat = this.trailsMesh.material as THREE.LineBasicMaterial;
      mat.opacity = intensity * 0.6;
    }

    return {
      inSlipstream,
      intensity,
      leaderCarName: closestLeaderName,
      dragReductionPercent: Math.round(dragReduction)
    };
  }
}
