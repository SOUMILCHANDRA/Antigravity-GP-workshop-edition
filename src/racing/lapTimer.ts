import * as THREE from 'three';
import { type VehicleController } from '../physics/vehicleController';
import { type VehicleTelemetry } from '../physics/vehiclePhysics';
import { type TrackSplineSample } from '../track/types';

export interface SectorSplit {
  sectorIndex: number; // 0, 1, 2
  splitTimeSeconds: number;
  deltaToBestSeconds: number;
  isBestSector: boolean;
}

export interface LapRecord {
  lapNumber: number;
  lapTimeSeconds: number;
  sector1Seconds: number;
  sector2Seconds: number;
  sector3Seconds: number;
  isValid: boolean;
  carId: string;
  timestamp: number;
}

export interface GhostFrame {
  timeSeconds: number;
  position: { x: number; y: number; z: number };
  rotationY: number;
}

export class LapTimer {
  private isRunning: boolean = false;
  private currentLapTime: number = 0;
  private currentLapNumber: number = 1;
  private isCurrentLapValid: boolean = true;
  private offTrackDuration: number = 0;

  // Sector boundaries (0.33 and 0.66 of spline distance)
  private currentSector: number = 0;
  private sectorTimes: [number, number, number] = [0, 0, 0];
  private bestSectorTimes: [number, number, number] = [Infinity, Infinity, Infinity];

  // Records
  private lastLapTime: number | null = null;
  private bestLapTime: number | null = null;
  private lapHistory: LapRecord[] = [];

  // Track Start/Finish Gate Detection
  private gatePosition: THREE.Vector3 = new THREE.Vector3();
  private gateNormal: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  private gateWidth: number = 16;
  private prevCarGateSide: number = 0;
  private hasCrossedStart: boolean = false;

  // Ghost Car Recording & Playback
  private currentLapGhostFrames: GhostFrame[] = [];
  private bestGhostFrames: GhostFrame[] = [];
  private ghostCarMesh: THREE.Mesh | null = null;
  private ghostPlaybackIndex: number = 0;

  // Listeners
  private onLapCompletedCallbacks: Array<(lap: LapRecord) => void> = [];
  private onSectorCompletedCallbacks: Array<(sector: SectorSplit) => void> = [];

  constructor(scene: THREE.Scene) {
    this.createGhostMesh(scene);
    this.loadBestLapFromStorage();
  }

  private createGhostMesh(scene: THREE.Scene): void {
    const ghostGeo = new THREE.BoxGeometry(1.8, 0.6, 4.2);
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.35,
      wireframe: true
    });
    this.ghostCarMesh = new THREE.Mesh(ghostGeo, ghostMat);
    this.ghostCarMesh.visible = false;
    scene.add(this.ghostCarMesh);
  }

  public setGate(position: THREE.Vector3, forwardHeadingRad: number, width: number): void {
    this.gatePosition.copy(position);
    this.gateNormal.set(Math.sin(forwardHeadingRad), 0, Math.cos(forwardHeadingRad)).normalize();
    this.gateWidth = width;
  }

  public setTrackSpline(samples: TrackSplineSample[]): void {
    if (samples.length > 0) {
      const p0 = samples[0];
      this.setGate(p0.position, Math.atan2(p0.tangent.x, p0.tangent.z), p0.width + 4);
    }
  }

  public onLapCompleted(callback: (lap: LapRecord) => void): void {
    this.onLapCompletedCallbacks.push(callback);
  }

  public onSectorCompleted(callback: (sector: SectorSplit) => void): void {
    this.onSectorCompletedCallbacks.push(callback);
  }

  public reset(): void {
    this.currentLapTime = 0;
    this.currentLapNumber = 1;
    this.isCurrentLapValid = true;
    this.offTrackDuration = 0;
    this.currentSector = 0;
    this.sectorTimes = [0, 0, 0];
    this.hasCrossedStart = false;
    this.currentLapGhostFrames = [];
    if (this.ghostCarMesh) this.ghostCarMesh.visible = false;
  }

  public update(deltaSeconds: number, vehicle: VehicleController, telemetry: VehicleTelemetry): void {
    const carPos = vehicle.getPosition();

    // 1. Off-track detection & Lap Invalidation
    if (telemetry.isOffTrack) {
      this.offTrackDuration += deltaSeconds;
      if (this.offTrackDuration > 0.8 && this.isCurrentLapValid) {
        this.isCurrentLapValid = false;
        console.warn('[LapTimer] Lap invalidated: Off-track limits exceeded');
      }
    } else {
      this.offTrackDuration = Math.max(0, this.offTrackDuration - deltaSeconds * 2);
    }

    // 2. Start/Finish Gate Crossing Check
    const toCar = carPos.clone().sub(this.gatePosition);
    const gateSide = toCar.dot(this.gateNormal); // Positive = ahead, Negative = behind
    const lateralDistToGate = toCar.clone().projectOnPlane(this.gateNormal).length();

    // Crossing condition: Transitioned from behind (<0) to ahead (>=0) within gate width
    if (this.prevCarGateSide < 0 && gateSide >= 0 && lateralDistToGate <= this.gateWidth * 0.75) {
      if (!this.hasCrossedStart) {
        // Initial race start crossing
        this.hasCrossedStart = true;
        this.currentLapTime = 0;
        this.isRunning = true;
        console.info('[LapTimer] Green Flag: Lap 1 started!');
      } else if (this.currentLapTime > 5.0) {
        // Lap Completed!
        this.completeLap(telemetry.carName);
      }
    }
    this.prevCarGateSide = gateSide;

    if (this.isRunning) {
      this.currentLapTime += deltaSeconds;

      // Sector 1 & Sector 2 split checking
      // Record ghost frame at ~30Hz
      this.currentLapGhostFrames.push({
        timeSeconds: this.currentLapTime,
        position: { x: carPos.x, y: carPos.y, z: carPos.z },
        rotationY: vehicle.getQuaternion().y
      });

      // Update Ghost Car Playback
      this.updateGhostPlayback();
    }
  }

  private completeLap(carId: string): void {
    const completedLapTime = this.currentLapTime;
    this.sectorTimes[2] = completedLapTime - (this.sectorTimes[0] + this.sectorTimes[1]);

    const record: LapRecord = {
      lapNumber: this.currentLapNumber,
      lapTimeSeconds: completedLapTime,
      sector1Seconds: this.sectorTimes[0],
      sector2Seconds: this.sectorTimes[1],
      sector3Seconds: this.sectorTimes[2],
      isValid: this.isCurrentLapValid,
      carId,
      timestamp: Date.now()
    };

    this.lapHistory.push(record);
    this.lastLapTime = completedLapTime;

    if (this.isCurrentLapValid) {
      if (this.bestLapTime === null || completedLapTime < this.bestLapTime) {
        this.bestLapTime = completedLapTime;
        this.bestGhostFrames = [...this.currentLapGhostFrames];
        this.saveBestLapToStorage();
        console.info(`[LapTimer] 🟣 NEW BEST LAP: ${this.formatTime(completedLapTime)}`);
      } else {
        console.info(`[LapTimer] 🟢 Lap ${this.currentLapNumber} completed: ${this.formatTime(completedLapTime)}`);
      }
    } else {
      console.warn(`[LapTimer] ⚠️ Lap ${this.currentLapNumber} completed (INVALID): ${this.formatTime(completedLapTime)}`);
    }

    this.onLapCompletedCallbacks.forEach(cb => cb(record));

    // Reset for next lap
    this.currentLapNumber++;
    this.currentLapTime = 0;
    this.isCurrentLapValid = true;
    this.offTrackDuration = 0;
    this.currentSector = 0;
    this.sectorTimes = [0, 0, 0];
    this.currentLapGhostFrames = [];
    this.ghostPlaybackIndex = 0;
  }

  private updateGhostPlayback(): void {
    if (!this.ghostCarMesh || this.bestGhostFrames.length === 0) {
      if (this.ghostCarMesh) this.ghostCarMesh.visible = false;
      return;
    }

    this.ghostCarMesh.visible = true;
    while (
      this.ghostPlaybackIndex < this.bestGhostFrames.length - 1 &&
      this.bestGhostFrames[this.ghostPlaybackIndex].timeSeconds < this.currentLapTime
    ) {
      this.ghostPlaybackIndex++;
    }

    const frame = this.bestGhostFrames[this.ghostPlaybackIndex];
    if (frame) {
      this.ghostCarMesh.position.set(frame.position.x, frame.position.y + 0.3, frame.position.z);
    }
  }

  public formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds === Infinity) return '--:--.---';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  public getCurrentLapTime(): number {
    return this.currentLapTime;
  }

  public getLastLapTime(): number | null {
    return this.lastLapTime;
  }

  public getBestLapTime(): number | null {
    return this.bestLapTime;
  }

  public getCurrentLapNumber(): number {
    return this.currentLapNumber;
  }

  public isLapValid(): boolean {
    return this.isCurrentLapValid;
  }

  public getCurrentSector(): number {
    return this.currentSector;
  }

  public getBestSectorTimes(): [number, number, number] {
    return this.bestSectorTimes;
  }

  private saveBestLapToStorage(): void {
    if (this.bestLapTime !== null) {
      localStorage.setItem('antigravity_best_lap', this.bestLapTime.toString());
    }
  }

  private loadBestLapFromStorage(): void {
    const saved = localStorage.getItem('antigravity_best_lap');
    if (saved) {
      this.bestLapTime = parseFloat(saved);
    }
  }
}
