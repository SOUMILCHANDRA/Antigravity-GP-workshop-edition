import * as THREE from 'three';
import { AIRacer, type AIRacerConfig } from './aiRacer';
import { QualityTier } from '../core/types';
import { type TrackSplineSample } from '../track/types';
import { type SurfaceMap } from '../track/surfaceMap';
import { type VehicleController } from '../physics/vehicleController';

export interface LeaderboardEntry {
  position: number;
  driverName: string;
  carName: string;
  isPlayer: boolean;
  intervalText: string;
  currentLap: number;
}

export class AIGridManager {
  private scene: THREE.Scene;
  private aiRacers: AIRacer[] = [];
  private isRaceActive: boolean = false;
  private startCountdownSeconds: number = 0;
  private startLightsCount: number = 0; // 0..5 red lights

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public setupGrid(
    samples: TrackSplineSample[],
    surfaceMap: SurfaceMap | null,
    gridCount: number = 5,
    tier: QualityTier = QualityTier.High
  ): void {
    // Clear previous AI cars
    this.aiRacers.forEach(ai => this.scene.remove(ai.group));
    this.aiRacers = [];

    const opponentConfigs: AIRacerConfig[] = [
      { id: 'ai_1', name: 'Ayrton S.', driverName: 'A. Senna', carId: 'mclaren_mp45', skillLevel: 1.15, gridPosition: 2 },
      { id: 'ai_2', name: 'Emerson F.', driverName: 'E. Fittipaldi', carId: 'lotus_72d', skillLevel: 1.05, gridPosition: 3 },
      { id: 'ai_3', name: 'Chris A.', driverName: 'C. Amon', carId: 'ferrari_312', skillLevel: 0.98, gridPosition: 4 },
      { id: 'ai_4', name: 'Alain P.', driverName: 'A. Prost', carId: 'mclaren_mp45', skillLevel: 1.12, gridPosition: 5 },
      { id: 'ai_5', name: 'Jochen R.', driverName: 'J. Rindt', carId: 'lotus_72d', skillLevel: 1.02, gridPosition: 6 }
    ];

    const count = Math.min(gridCount, opponentConfigs.length);
    for (let i = 0; i < count; i++) {
      const racer = new AIRacer(this.scene, opponentConfigs[i], tier);
      racer.setTrackSamples(samples, surfaceMap);
      racer.setGridSpawn(i + 1); // Grid index 1..N (0 is Player)
      this.aiRacers.push(racer);
    }
  }

  public startRace(): void {
    this.isRaceActive = true;
    this.startCountdownSeconds = 4.0;
  }

  public update(deltaSeconds: number, playerVehicle: VehicleController): void {
    if (!this.isRaceActive) return;

    if (this.startCountdownSeconds > 0) {
      this.startCountdownSeconds -= deltaSeconds;
      this.startLightsCount = Math.min(5, Math.floor((4.0 - this.startCountdownSeconds) * 1.5));
      if (this.startCountdownSeconds <= 0) {
        this.startLightsCount = 0; // Lights out!
        console.info('[Race] 🏁 LIGHTS OUT AND AWAY WE GO!');
      }
      return;
    }

    const allPositions = [playerVehicle.getPosition(), ...this.aiRacers.map(a => a.position)];

    this.aiRacers.forEach(ai => {
      ai.update(deltaSeconds, allPositions);
    });
  }

  public getLeaderboard(playerVehicle: VehicleController): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    const playerPos = playerVehicle.getPosition();

    entries.push({
      position: 1,
      driverName: 'PLAYER (You)',
      carName: playerVehicle.getCurrentCarSpecs().name,
      isPlayer: true,
      intervalText: 'LEADER',
      currentLap: 1
    });

    this.aiRacers.forEach((ai, idx) => {
      const distToPlayer = ai.position.distanceTo(playerPos);
      const isAhead = ai.position.z > playerPos.z;
      const interval = (distToPlayer / Math.max(10, ai.speedMs || 10)).toFixed(1);

      entries.push({
        position: idx + 2,
        driverName: ai.config.driverName,
        carName: ai.config.name,
        isPlayer: false,
        intervalText: isAhead ? `-${interval}s` : `+${interval}s`,
        currentLap: ai.currentLap
      });
    });

    return entries;
  }

  public getAiRacers(): AIRacer[] {
    return this.aiRacers;
  }

  public getStartLightsCount(): number {
    return this.startLightsCount;
  }
}
