import { type CarSpecs } from '../cars/carData';

export interface PowertrainOutput {
  engineRpm: number;
  engineTorqueNm: number;
  driveTorquePerRearWheelNm: number; // Delivered to RL & RR
  currentGear: number; // -1 = Reverse, 0 = Neutral, 1..N = Forward
  gearRatio: number;
  clutchEngaged: boolean;
  wheelBrakeTorqueFrontNm: number;
  wheelBrakeTorqueRearNm: number;
}

export class Powertrain {
  private specs: CarSpecs;
  private currentRpm: number;
  private currentGear: number = 1; // Start in 1st gear
  private gearRatios: number[] = [];
  private finalDriveRatio: number = 3.8;
  private reverseRatio: number = -3.4;
  private shiftTimer: number = 0;
  private isShifting: boolean = false;
  private shiftDuration: number = 0.12; // 120ms shift time
  private targetGear: number = 1;

  constructor(specs: CarSpecs) {
    this.specs = specs;
    this.currentRpm = specs.idleRpm;
    this.setupGearRatios();
  }

  public setSpecs(specs: CarSpecs): void {
    this.specs = specs;
    this.currentRpm = Math.max(this.currentRpm, specs.idleRpm);
    this.setupGearRatios();
  }

  private setupGearRatios(): void {
    // Generate period gear spacing based on top speed and gear count
    if (this.specs.gearCount === 5) {
      // 5-speed 60s/70s F1 (Ferrari / Lotus)
      this.gearRatios = [3.20, 2.15, 1.62, 1.28, 1.02];
      this.finalDriveRatio = 3.65;
    } else {
      // 6-speed 80s Turbo/NA F1 (McLaren MP4/5)
      this.gearRatios = [3.05, 2.25, 1.75, 1.42, 1.18, 0.98];
      this.finalDriveRatio = 3.90;
    }
  }

  /**
   * Calculates engine torque based on RPM using parabolic torque curve peaking at peakTorqueRpm
   */
  public getEngineTorqueAtRpm(rpm: number): number {
    const { idleRpm, maxRpm, peakTorqueRpm, peakTorqueNm, peakHpRpm, peakHorsepower } = this.specs;

    if (rpm < idleRpm * 0.5) return 0;

    // Converted peak power (HP -> Watts -> Torque Nm = P / omega)
    const peakPowerTorqueNm = (peakHorsepower * 745.7) / (peakHpRpm * (Math.PI / 30));

    // Blended curve between low RPM rise, peak torque, and high RPM power plateau
    let torque = 0;
    if (rpm <= peakTorqueRpm) {
      const t = (rpm - idleRpm) / Math.max(1, peakTorqueRpm - idleRpm);
      torque = (peakTorqueNm * 0.65) + (peakTorqueNm * 0.35) * Math.sin(Math.max(0, t) * Math.PI * 0.5);
    } else if (rpm <= peakHpRpm) {
      const t = (rpm - peakTorqueRpm) / Math.max(1, peakHpRpm - peakTorqueRpm);
      torque = peakTorqueNm + (peakPowerTorqueNm - peakTorqueNm) * t;
    } else {
      const t = (rpm - peakHpRpm) / Math.max(1, maxRpm - peakHpRpm);
      // Rev limiter soft-cut drop off
      torque = peakPowerTorqueNm * Math.max(0, 1.0 - t * 1.5);
    }

    return Math.max(0, torque);
  }

  /**
   * Updates powertrain state, automatic gear shifting, engine RPM, and wheel torques
   * @param throttle 0..1
   * @param brake 0..1
   * @param rearWheelAvgAngularVelRadS Average angular velocity of driven rear wheels
   * @param vehicleSpeedMs Forward chassis speed (m/s)
   * @param dt Timestep (s)
   */
  public update(
    throttle: number,
    brake: number,
    rearWheelAvgAngularVelRadS: number,
    vehicleSpeedMs: number,
    dt: number
  ): PowertrainOutput {
    // 1. Shift Timer Processing
    if (this.isShifting) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.isShifting = false;
        this.currentGear = this.targetGear;
      }
    }

    // 2. Compute Active Gear Ratio
    let activeRatio = 0;
    if (this.currentGear > 0 && this.currentGear <= this.gearRatios.length) {
      activeRatio = this.gearRatios[this.currentGear - 1] * this.finalDriveRatio;
    } else if (this.currentGear === -1) {
      activeRatio = this.reverseRatio * this.finalDriveRatio;
    }

    // 3. Engine RPM matching with wheel speed and clutch slip
    const wheelRpm = (rearWheelAvgAngularVelRadS * 60) / (2 * Math.PI);
    const driveShaftRpm = Math.abs(wheelRpm * activeRatio);

    if (!this.isShifting && activeRatio !== 0) {
      // RPM tracks wheels with idle floor & throttle revving
      const targetRpm = Math.max(this.specs.idleRpm, driveShaftRpm);
      this.currentRpm = Math.min(this.specs.maxRpm + 200, this.currentRpm + (targetRpm - this.currentRpm) * Math.min(1, dt * 18));
      if (throttle > 0.1 && this.currentRpm < this.specs.idleRpm * 1.5) {
        this.currentRpm += throttle * 4000 * dt;
      }
    } else {
      // In neutral/shifting: rev freely on throttle, drop to idle on release
      if (throttle > 0.05) {
        this.currentRpm += throttle * 8000 * dt;
      } else {
        this.currentRpm -= 5000 * dt;
      }
      this.currentRpm = Math.max(this.specs.idleRpm, Math.min(this.specs.maxRpm, this.currentRpm));
    }

    // 4. Automatic Transmission Upshift / Downshift Logic
    if (!this.isShifting) {
      const upshiftRpm = this.specs.maxRpm * 0.94;
      const downshiftRpm = this.specs.peakTorqueRpm * 0.65;

      // Upshift condition
      if (this.currentGear > 0 && this.currentGear < this.gearRatios.length && this.currentRpm >= upshiftRpm && throttle > 0.3) {
        this.initiateShift(this.currentGear + 1);
      }
      // Downshift condition
      else if (this.currentGear > 1 && this.currentRpm < downshiftRpm && vehicleSpeedMs < (this.specs.topSpeedKmh / 3.6) * 0.85) {
        this.initiateShift(this.currentGear - 1);
      }
      // Reverse shift
      else if (this.currentGear >= 0 && vehicleSpeedMs < 0.5 && brake > 0.7 && throttle < 0.05) {
        // Can enter reverse if stopped and holding brake
        this.currentGear = -1;
      }
      // Return to 1st from reverse
      else if (this.currentGear === -1 && throttle > 0.1) {
        this.currentGear = 1;
      }
    }

    // 5. Compute Drive Torque Delivered to Wheels
    const engineTorque = this.getEngineTorqueAtRpm(this.currentRpm) * throttle;
    let driveTorquePerRearWheelNm = 0;

    if (!this.isShifting && activeRatio !== 0) {
      const totalDriveTorque = engineTorque * activeRatio * 0.92; // 92% drivetrain efficiency
      // Split evenly across RWD axle (RL & RR)
      driveTorquePerRearWheelNm = totalDriveTorque * 0.5;
    }

    // 6. Brake Torques (58% Front : 42% Rear Brake Bias)
    const maxBrakeTorque = this.specs.massKg * 9.81 * 2.8; // ~2.8G braking potential
    const totalBrakeTorque = maxBrakeTorque * brake;
    const wheelBrakeTorqueFrontNm = (totalBrakeTorque * 0.58) * 0.5; // per front wheel
    const wheelBrakeTorqueRearNm = (totalBrakeTorque * 0.42) * 0.5;  // per rear wheel

    return {
      engineRpm: Math.round(this.currentRpm),
      engineTorqueNm: engineTorque,
      driveTorquePerRearWheelNm,
      currentGear: this.currentGear,
      gearRatio: activeRatio,
      clutchEngaged: !this.isShifting,
      wheelBrakeTorqueFrontNm,
      wheelBrakeTorqueRearNm
    };
  }

  private initiateShift(targetGear: number): void {
    this.isShifting = true;
    this.targetGear = targetGear;
    this.shiftTimer = this.shiftDuration;
  }

  public shiftUp(): void {
    if (this.currentGear < this.gearRatios.length && !this.isShifting) {
      this.initiateShift(this.currentGear + 1);
    }
  }

  public shiftDown(): void {
    if (this.currentGear > 1 && !this.isShifting) {
      this.initiateShift(this.currentGear - 1);
    }
  }

  public getCurrentGear(): number {
    return this.currentGear;
  }
}
