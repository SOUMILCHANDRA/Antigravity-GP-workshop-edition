import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { type CarSpecs } from '../cars/carData';
import { type SurfaceMap } from '../track/surfaceMap';
import { type SurfaceSampleResult } from '../track/types';
import { PacejkaTire, type TireForceResult } from './pacejkaTire';
import { Powertrain, type PowertrainOutput } from './powertrain';

export interface WheelState {
  index: number;
  name: 'FL' | 'FR' | 'RL' | 'RR';
  isFront: boolean;
  isLeft: boolean;
  hardpointLocal: THREE.Vector3; // Relative to chassis origin
  contactWorldPos: THREE.Vector3;
  rayHitDistance: number;
  suspensionCompression: number; // 0 (uncompressed) .. maxTravel
  springForceN: number;
  damperForceN: number;
  normalLoadFz: number; // Vertical load on tire (N)
  steerAngleRad: number;
  angularVelocityRadS: number;
  surfaceResult: SurfaceSampleResult;
  tireForce: TireForceResult;
  isGrounded: boolean;
  wheelLinearSpeedMs: number; // Wheel forward surface speed = omega * R
}

export interface VehicleTelemetry {
  speedKmh: number;
  speedMs: number;
  engineRpm: number;
  currentGear: number;
  throttle: number;
  brake: number;
  steerAngleDeg: number;
  gForceLat: number;
  gForceLong: number;
  isOffTrack: boolean;
  offTrackWheelCount: number;
  wheelStates: WheelState[];
  currentDragPenalty: number;
  carName: string;
  powertrain: PowertrainOutput;
  chassisPosition: THREE.Vector3;
  chassisRotation: THREE.Quaternion;
}

export class VehiclePhysics {
  private world: RAPIER.World;
  private rigidBody: RAPIER.RigidBody;
  private specs: CarSpecs;
  private surfaceMap: SurfaceMap | null = null;
  private powertrain: Powertrain;

  // Suspension & Dimensions
  private wheelRadius: number = 0.33; // ~66cm diameter F1 tire
  private suspensionRestLength: number = 0.32;
  private suspensionMaxTravel: number = 0.16;
  private springStiffness: number = 38000; // N/m
  private damperCompression: number = 3200; // Ns/m
  private damperRebound: number = 4200; // Ns/m
  private antiRollBarStiffnessFront: number = 8000; // N/m
  private antiRollBarStiffnessRear: number = 6000;  // N/m

  // Wheel States (FL, FR, RL, RR)
  private wheels: WheelState[] = [];
  private previousWheelCompressions: number[] = [0, 0, 0, 0];

  // Control Inputs
  private throttleInput: number = 0;
  private brakeInput: number = 0;
  private steerInput: number = 0; // -1 (left) .. +1 (right)
  private smoothedSteerAngle: number = 0;
  private maxSteerAngleRad: number = THREE.MathUtils.degToRad(30);

  // Dynamic Acceleration Tracking (for G-forces and weight transfer)
  private lastLinearVelocity: THREE.Vector3 = new THREE.Vector3();
  private smoothedAcceleration: THREE.Vector3 = new THREE.Vector3();

  // Interpolation State Buffers
  private prevPosition: THREE.Vector3 = new THREE.Vector3();
  private prevRotation: THREE.Quaternion = new THREE.Quaternion();
  private currPosition: THREE.Vector3 = new THREE.Vector3();
  private currRotation: THREE.Quaternion = new THREE.Quaternion();

  constructor(world: RAPIER.World, specs: CarSpecs, initialPosition: THREE.Vector3, initialHeadingRad: number) {
    this.world = world;
    this.specs = specs;
    this.powertrain = new Powertrain(specs);

    // Create Rapier Dynamic Rigid Body
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(initialPosition.x, initialPosition.y + 0.3, initialPosition.z)
      .setRotation({
        x: 0,
        y: Math.sin(initialHeadingRad / 2),
        z: 0,
        w: Math.cos(initialHeadingRad / 2)
      })
      .setLinearDamping(0.05)
      .setAngularDamping(0.8)
      .setCanSleep(false);

    this.rigidBody = this.world.createRigidBody(rigidBodyDesc);

    // Create Chassis Box Collider (protects against tunneling & collisions)
    const halfLength = specs.lengthMeters * 0.45;
    const halfWidth = specs.widthMeters * 0.42;
    const halfHeight = 0.22;
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
      .setMass(specs.massKg)
      .setFriction(0.2)
      .setRestitution(0.1);

    this.world.createCollider(colliderDesc, this.rigidBody);

    this.setupWheels();
    this.syncInitialState();
  }

  public setSpecs(specs: CarSpecs): void {
    this.specs = specs;
    this.powertrain.setSpecs(specs);
    this.setupWheels();
  }

  public setSurfaceMap(map: SurfaceMap | null): void {
    this.surfaceMap = map;
  }

  private setupWheels(): void {
    const halfL = this.specs.wheelbaseMeters / 2;
    const halfWFront = this.specs.frontTrackMeters / 2;
    const halfWRear = this.specs.rearTrackMeters / 2;
    const hardpointHeight = 0.10; // Attachment point above chassis bottom

    // Note: In Rapier/Three chassis space:
    // +Z is Forward, -Z is Rear (standard longitudinal)
    // +X is Right, -X is Left (lateral)
    // +Y is Up
    this.wheels = [
      {
        index: 0,
        name: 'FL',
        isFront: true,
        isLeft: true,
        hardpointLocal: new THREE.Vector3(-halfWFront, hardpointHeight, halfL),
        contactWorldPos: new THREE.Vector3(),
        rayHitDistance: this.suspensionRestLength,
        suspensionCompression: 0,
        springForceN: 0,
        damperForceN: 0,
        normalLoadFz: (this.specs.massKg * 9.81 * this.specs.weightDistributionFrontRatio) / 2,
        steerAngleRad: 0,
        angularVelocityRadS: 0,
        surfaceResult: this.getDefaultSurfaceResult(),
        tireForce: { fx: 0, fy: 0, slipAngleDeg: 0, slipRatio: 0, gripFraction: 1 },
        isGrounded: true,
        wheelLinearSpeedMs: 0
      },
      {
        index: 1,
        name: 'FR',
        isFront: true,
        isLeft: false,
        hardpointLocal: new THREE.Vector3(halfWFront, hardpointHeight, halfL),
        contactWorldPos: new THREE.Vector3(),
        rayHitDistance: this.suspensionRestLength,
        suspensionCompression: 0,
        springForceN: 0,
        damperForceN: 0,
        normalLoadFz: (this.specs.massKg * 9.81 * this.specs.weightDistributionFrontRatio) / 2,
        steerAngleRad: 0,
        angularVelocityRadS: 0,
        surfaceResult: this.getDefaultSurfaceResult(),
        tireForce: { fx: 0, fy: 0, slipAngleDeg: 0, slipRatio: 0, gripFraction: 1 },
        isGrounded: true,
        wheelLinearSpeedMs: 0
      },
      {
        index: 2,
        name: 'RL',
        isFront: false,
        isLeft: true,
        hardpointLocal: new THREE.Vector3(-halfWRear, hardpointHeight, -halfL),
        contactWorldPos: new THREE.Vector3(),
        rayHitDistance: this.suspensionRestLength,
        suspensionCompression: 0,
        springForceN: 0,
        damperForceN: 0,
        normalLoadFz: (this.specs.massKg * 9.81 * (1 - this.specs.weightDistributionFrontRatio)) / 2,
        steerAngleRad: 0,
        angularVelocityRadS: 0,
        surfaceResult: this.getDefaultSurfaceResult(),
        tireForce: { fx: 0, fy: 0, slipAngleDeg: 0, slipRatio: 0, gripFraction: 1 },
        isGrounded: true,
        wheelLinearSpeedMs: 0
      },
      {
        index: 3,
        name: 'RR',
        isFront: false,
        isLeft: false,
        hardpointLocal: new THREE.Vector3(halfWRear, hardpointHeight, -halfL),
        contactWorldPos: new THREE.Vector3(),
        rayHitDistance: this.suspensionRestLength,
        suspensionCompression: 0,
        springForceN: 0,
        damperForceN: 0,
        normalLoadFz: (this.specs.massKg * 9.81 * (1 - this.specs.weightDistributionFrontRatio)) / 2,
        steerAngleRad: 0,
        angularVelocityRadS: 0,
        surfaceResult: this.getDefaultSurfaceResult(),
        tireForce: { fx: 0, fy: 0, slipAngleDeg: 0, slipRatio: 0, gripFraction: 1 },
        isGrounded: true,
        wheelLinearSpeedMs: 0
      }
    ];
  }

  private getDefaultSurfaceResult(): SurfaceSampleResult {
    return {
      surface: {
        type: 'tarmac',
        name: 'Racing Asphalt',
        frictionMultiplier: 1.0,
        rollingDragMultiplier: 1.0,
        decelerationPenalty: 0.0,
        isDrivable: true,
        colorHex: 0x222228
      },
      elevation: 0,
      normal: new THREE.Vector3(0, 1, 0),
      distanceToCenterline: 0,
      trackWidthAtPoint: 12,
      isInsideTrackBounds: true
    };
  }

  public setInputs(throttle: number, brake: number, steer: number): void {
    this.throttleInput = Math.max(0, Math.min(1, throttle));
    this.brakeInput = Math.max(0, Math.min(1, brake));
    this.steerInput = Math.max(-1, Math.min(1, steer));
  }

  public teleport(position: THREE.Vector3, headingRad: number): void {
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
    this.rigidBody.setTranslation({ x: position.x, y: position.y + 0.35, z: position.z }, true);
    this.rigidBody.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.wheels.forEach(w => {
      w.angularVelocityRadS = 0;
      w.suspensionCompression = 0;
    });
    this.syncInitialState();
  }

  private syncInitialState(): void {
    const t = this.rigidBody.translation();
    const r = this.rigidBody.rotation();
    this.currPosition.set(t.x, t.y, t.z);
    this.currRotation.set(r.x, r.y, r.z, r.w);
    this.prevPosition.copy(this.currPosition);
    this.prevRotation.copy(this.currRotation);
  }

  /**
   * Fixed 120Hz physics sub-step integration
   */
  public stepSubstep(dt: number): void {
    // Cache previous state for render interpolation
    this.prevPosition.copy(this.currPosition);
    this.prevRotation.copy(this.currRotation);

    const trans = this.rigidBody.translation();
    const rot = this.rigidBody.rotation();
    const linvel = this.rigidBody.linvel();
    const angvel = this.rigidBody.angvel();

    const chassisPos = new THREE.Vector3(trans.x, trans.y, trans.z);
    const chassisQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const worldLinvel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const worldAngvel = new THREE.Vector3(angvel.x, angvel.y, angvel.z);

    // Chassis Direction Vectors
    const forwardVec = new THREE.Vector3(0, 0, 1).applyQuaternion(chassisQuat).normalize();
    const rightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(chassisQuat).normalize();
    const upVec = new THREE.Vector3(0, 1, 0).applyQuaternion(chassisQuat).normalize();

    // Local linear velocity
    const localForwardSpeed = worldLinvel.dot(forwardVec);

    // Acceleration calculation for G-meter and weight transfer
    const currentAccel = worldLinvel.clone().sub(this.lastLinearVelocity).divideScalar(dt);
    this.lastLinearVelocity.copy(worldLinvel);
    this.smoothedAcceleration.lerp(currentAccel, dt * 15);

    // Steer input smoothing (with speed-sensitive steering reduction)
    const speedKmh = Math.abs(localForwardSpeed * 3.6);
    const speedSteerFactor = Math.max(0.35, 1.0 - (speedKmh / 280) * 0.65);
    const targetSteerAngle = -this.steerInput * this.maxSteerAngleRad * speedSteerFactor;
    this.smoothedSteerAngle = THREE.MathUtils.lerp(this.smoothedSteerAngle, targetSteerAngle, dt * 18);

    // 1. Suspension & Surface Raycasting per Wheel
    const totalMass = this.specs.massKg;
    const gravity = 9.81;
    const staticLoadFront = (totalMass * gravity * this.specs.weightDistributionFrontRatio) / 2;
    const staticLoadRear = (totalMass * gravity * (1.0 - this.specs.weightDistributionFrontRatio)) / 2;

    // Dynamic Weight Transfer Forces
    const hCg = this.specs.centerOfGravityHeightMeters;
    const wheelbase = this.specs.wheelbaseMeters;
    const trackWidth = (this.specs.frontTrackMeters + this.specs.rearTrackMeters) / 2;

    const longAccel = this.smoothedAcceleration.dot(forwardVec);
    const latAccel = this.smoothedAcceleration.dot(rightVec);

    const deltaLoadLongitudinal = (totalMass * longAccel * hCg) / wheelbase;
    const deltaLoadLateralFront = (totalMass * latAccel * hCg * this.specs.weightDistributionFrontRatio) / trackWidth;
    const deltaLoadLateralRear = (totalMass * latAccel * hCg * (1 - this.specs.weightDistributionFrontRatio)) / trackWidth;

    // Average rear wheel velocity for powertrain
    const rearWheelsAvgAngVel = (this.wheels[2].angularVelocityRadS + this.wheels[3].angularVelocityRadS) * 0.5;
    const powertrainOut = this.powertrain.update(
      this.throttleInput,
      this.brakeInput,
      rearWheelsAvgAngVel,
      localForwardSpeed,
      dt
    );

    // 2. Iterate each wheel: Raycast ground, compute suspension, and apply Pacejka tire forces
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      const hardpointWorld = wheel.hardpointLocal.clone().applyQuaternion(chassisQuat).add(chassisPos);

      // Sample surface from track SurfaceMap
      let groundElevation = 0;
      let groundNormal = new THREE.Vector3(0, 1, 0);
      let sampleResult = this.getDefaultSurfaceResult();

      if (this.surfaceMap) {
        sampleResult = this.surfaceMap.sampleSurface(hardpointWorld.x, hardpointWorld.z);
        groundElevation = sampleResult.elevation;
        groundNormal.copy(sampleResult.normal);
      }

      wheel.surfaceResult = sampleResult;

      // Calculate ground contact intersection
      const groundContactY = groundElevation;
      const heightAboveGround = hardpointWorld.y - groundContactY;
      const hitDistance = Math.max(0, heightAboveGround - this.wheelRadius);

      const isHit = hitDistance <= this.suspensionRestLength;
      wheel.isGrounded = isHit;

      if (isHit) {
        const compression = Math.max(0, Math.min(this.suspensionMaxTravel, this.suspensionRestLength - hitDistance));
        wheel.suspensionCompression = compression;
        wheel.contactWorldPos.set(hardpointWorld.x, groundContactY + this.wheelRadius, hardpointWorld.z);

        // Suspension Velocity (Compression Rate)
        const compressionVelocity = (compression - this.previousWheelCompressions[i]) / dt;
        this.previousWheelCompressions[i] = compression;

        // Spring + Damper Force
        const damperRate = compressionVelocity >= 0 ? this.damperCompression : this.damperRebound;
        wheel.springForceN = this.springStiffness * compression;
        wheel.damperForceN = damperRate * compressionVelocity;

        let dynamicLoad = wheel.isFront
          ? staticLoadFront - deltaLoadLongitudinal * 0.5 + (wheel.isLeft ? -deltaLoadLateralFront : deltaLoadLateralFront)
          : staticLoadRear + deltaLoadLongitudinal * 0.5 + (wheel.isLeft ? -deltaLoadLateralRear : deltaLoadLateralRear);

        wheel.normalLoadFz = Math.max(100, Math.min(totalMass * gravity * 2.5, dynamicLoad + wheel.springForceN + wheel.damperForceN));

        // Apply Suspension Upward Force to Chassis
        const suspensionForceWorld = groundNormal.clone().multiplyScalar(wheel.springForceN + wheel.damperForceN);
        this.applyForceAtWorldPoint(suspensionForceWorld, hardpointWorld);

        // Wheel Direction with Steering
        wheel.steerAngleRad = wheel.isFront ? this.smoothedSteerAngle : 0;
        const wheelHeadingQuat = chassisQuat.clone().multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wheel.steerAngleRad)
        );

        const wheelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(wheelHeadingQuat).normalize();
        const wheelRight = new THREE.Vector3(1, 0, 0).applyQuaternion(wheelHeadingQuat).normalize();

        // Velocity at wheel contact patch
        const rChassisToContact = wheel.contactWorldPos.clone().sub(chassisPos);
        const contactVelocity = worldLinvel.clone().add(worldAngvel.clone().cross(rChassisToContact));

        const wheelLongSpeed = contactVelocity.dot(wheelForward);
        const wheelLatSpeed = contactVelocity.dot(wheelRight);

        // Longitudinal Drive & Brake Torques
        const driveTorque = !wheel.isFront ? powertrainOut.driveTorquePerRearWheelNm : 0;
        const brakeTorque = wheel.isFront ? powertrainOut.wheelBrakeTorqueFrontNm : powertrainOut.wheelBrakeTorqueRearNm;

        // Wheel Angular Acceleration & Slip
        const wheelInertia = 1.2; // kg*m^2 per wheel
        const netWheelTorque = driveTorque - Math.sign(wheel.angularVelocityRadS) * brakeTorque;
        const angularAccel = netWheelTorque / wheelInertia;
        wheel.angularVelocityRadS += angularAccel * dt;

        wheel.wheelLinearSpeedMs = wheel.angularVelocityRadS * this.wheelRadius;

        // Calculate Slip Ratio & Slip Angle
        const maxV = Math.max(0.5, Math.abs(wheelLongSpeed));
        const slipRatio = Math.max(-1.0, Math.min(1.0, (wheel.wheelLinearSpeedMs - wheelLongSpeed) / maxV));
        const slipAngleRad = Math.atan2(wheelLatSpeed, Math.max(1.0, Math.abs(wheelLongSpeed)));

        // Evaluate Pacejka Magic Formula
        wheel.tireForce = PacejkaTire.calculateCombinedForces(
          wheel.normalLoadFz,
          slipRatio,
          slipAngleRad,
          sampleResult.surface,
          this.specs.tireType
        );

        // Apply Longitudinal & Lateral Forces to Chassis at Contact Patch
        const totalTireForceWorld = wheelForward.clone().multiplyScalar(wheel.tireForce.fx)
          .add(wheelRight.clone().multiplyScalar(wheel.tireForce.fy));

        // Rolling resistance & Surface Drag Penalty
        const rollingResistForce = -Math.sign(wheelLongSpeed) * (0.015 * wheel.normalLoadFz * sampleResult.surface.rollingDragMultiplier);
        totalTireForceWorld.add(wheelForward.clone().multiplyScalar(rollingResistForce));

        // Gravel Drag Penalty (Phase C)
        if (sampleResult.surface.decelerationPenalty > 0) {
          const gravelDecelForce = -Math.sign(wheelLongSpeed) * (totalMass * sampleResult.surface.decelerationPenalty * 0.25);
          totalTireForceWorld.add(wheelForward.clone().multiplyScalar(gravelDecelForce));
        }

        this.applyForceAtWorldPoint(totalTireForceWorld, wheel.contactWorldPos);

        // Wheel Speed Damping when braking / locked
        if (this.brakeInput > 0.1 && Math.abs(wheel.wheelLinearSpeedMs) < 0.2 && Math.abs(wheelLongSpeed) < 0.2) {
          wheel.angularVelocityRadS = 0;
        }
      } else {
        // Airborne wheel
        wheel.suspensionCompression = 0;
        wheel.normalLoadFz = 0;
        wheel.tireForce = { fx: 0, fy: 0, slipAngleDeg: 0, slipRatio: 0, gripFraction: 0 };
        wheel.angularVelocityRadS *= Math.max(0, 1.0 - dt * 2.0); // Spin-down in air
      }
    }

    // 3. Anti-Roll Bars Coupling (Front & Rear)
    const arbTravelDiffFront = this.wheels[0].suspensionCompression - this.wheels[1].suspensionCompression;
    const arbForceFront = arbTravelDiffFront * this.antiRollBarStiffnessFront;
    this.applyForceAtWorldPoint(upVec.clone().multiplyScalar(-arbForceFront), this.wheels[0].contactWorldPos);
    this.applyForceAtWorldPoint(upVec.clone().multiplyScalar(arbForceFront), this.wheels[1].contactWorldPos);

    const arbTravelDiffRear = this.wheels[2].suspensionCompression - this.wheels[3].suspensionCompression;
    const arbForceRear = arbTravelDiffRear * this.antiRollBarStiffnessRear;
    this.applyForceAtWorldPoint(upVec.clone().multiplyScalar(-arbForceRear), this.wheels[2].contactWorldPos);
    this.applyForceAtWorldPoint(upVec.clone().multiplyScalar(arbForceRear), this.wheels[3].contactWorldPos);

    // 4. Aerodynamic Downforce & Drag
    const airDensity = 1.225; // kg/m^3
    const speedSquared = localForwardSpeed * localForwardSpeed;
    const aeroDownforce = 0.5 * airDensity * speedSquared * this.specs.downforceCoefficient * this.specs.frontalAreaM2 * 9.81;
    const aeroDrag = 0.5 * airDensity * speedSquared * this.specs.dragCoefficient * this.specs.frontalAreaM2;

    // Downforce pushes downward onto chassis
    this.applyForceAtWorldPoint(upVec.clone().multiplyScalar(-aeroDownforce), chassisPos);
    // Aero Drag opposes forward motion
    this.applyForceAtWorldPoint(forwardVec.clone().multiplyScalar(-Math.sign(localForwardSpeed) * aeroDrag), chassisPos);

    // Update current interpolated state buffer
    const nextTrans = this.rigidBody.translation();
    const nextRot = this.rigidBody.rotation();
    this.currPosition.set(nextTrans.x, nextTrans.y, nextTrans.z);
    this.currRotation.set(nextRot.x, nextRot.y, nextRot.z, nextRot.w);
  }

  private applyForceAtWorldPoint(forceWorld: THREE.Vector3, pointWorld: THREE.Vector3): void {
    if (isNaN(forceWorld.x) || isNaN(forceWorld.y) || isNaN(forceWorld.z)) return;
    this.rigidBody.addForceAtPoint(
      { x: forceWorld.x, y: forceWorld.y, z: forceWorld.z },
      { x: pointWorld.x, y: pointWorld.y, z: pointWorld.z },
      true
    );
  }

  /**
   * Returns smooth interpolated visual state between physics sub-steps
   */
  public getInterpolatedTransform(alpha: number): { position: THREE.Vector3; rotation: THREE.Quaternion } {
    const pos = this.prevPosition.clone().lerp(this.currPosition, alpha);
    const rot = this.prevRotation.clone().slerp(this.currRotation, alpha);
    return { position: pos, rotation: rot };
  }

  public getTelemetry(): VehicleTelemetry {
    const linvel = this.rigidBody.linvel();
    const speedMs = Math.hypot(linvel.x, linvel.z);
    const speedKmh = speedMs * 3.6;

    const rot = this.rigidBody.rotation();
    const chassisQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const forwardVec = new THREE.Vector3(0, 0, 1).applyQuaternion(chassisQuat);
    const rightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(chassisQuat);

    const gLat = this.smoothedAcceleration.dot(rightVec) / 9.81;
    const gLong = this.smoothedAcceleration.dot(forwardVec) / 9.81;

    let offTrackCount = 0;
    let totalPenalty = 0;
    this.wheels.forEach(w => {
      if (!w.surfaceResult.surface.isDrivable) offTrackCount++;
      totalPenalty += w.surfaceResult.surface.decelerationPenalty;
    });

    const rearAvgAngVel = (this.wheels[2].angularVelocityRadS + this.wheels[3].angularVelocityRadS) * 0.5;
    const powertrainOut = this.powertrain.update(this.throttleInput, this.brakeInput, rearAvgAngVel, speedMs, 0.016);

    return {
      speedKmh,
      speedMs,
      engineRpm: powertrainOut.engineRpm,
      currentGear: powertrainOut.currentGear,
      throttle: this.throttleInput,
      brake: this.brakeInput,
      steerAngleDeg: THREE.MathUtils.radToDeg(this.smoothedSteerAngle),
      gForceLat: gLat,
      gForceLong: gLong,
      isOffTrack: offTrackCount >= 2,
      offTrackWheelCount: offTrackCount,
      wheelStates: this.wheels,
      currentDragPenalty: totalPenalty / 4,
      carName: this.specs.name,
      powertrain: powertrainOut,
      chassisPosition: this.currPosition,
      chassisRotation: this.currRotation
    };
  }

  public getRigidBody(): RAPIER.RigidBody {
    return this.rigidBody;
  }
}
