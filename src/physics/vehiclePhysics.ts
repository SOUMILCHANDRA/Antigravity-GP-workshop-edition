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
  hardpointLocal: THREE.Vector3;
  contactWorldPos: THREE.Vector3;
  rayHitDistance: number;
  suspensionCompression: number; // 0..maxTravel
  springForceN: number;
  damperForceN: number;
  normalLoadFz: number; // Vertical load on tire (N)
  steerAngleRad: number;
  angularVelocityRadS: number;
  surfaceResult: SurfaceSampleResult;
  tireForce: TireForceResult;
  isGrounded: boolean;
  wheelLinearSpeedMs: number;
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

  // Wheel & Suspension Dimensions
  private wheelRadius: number = 0.33; // 66cm diameter F1 tire
  private suspensionRestLength: number = 0.28;
  private suspensionMaxTravel: number = 0.14;
  private springStiffness: number = 24000; // N/m
  private damperRate: number = 2200; // Ns/m
  private antiRollBarStiffness: number = 4000; // N/m

  // Wheel States (FL, FR, RL, RR)
  private wheels: WheelState[] = [];

  // Inputs
  private throttleInput: number = 0;
  private brakeInput: number = 0;
  private steerInput: number = 0;
  private smoothedSteerAngle: number = 0;
  private maxSteerAngleRad: number = THREE.MathUtils.degToRad(30);

  // Dynamic Acceleration Tracking (for G-meter)
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

    // Initial spawn height slightly above ground
    const spawnY = initialPosition.y + this.wheelRadius + this.suspensionRestLength * 0.7;

    // Create Rapier Dynamic Rigid Body
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(initialPosition.x, spawnY, initialPosition.z)
      .setRotation({
        x: 0,
        y: Math.sin(initialHeadingRad / 2),
        z: 0,
        w: Math.cos(initialHeadingRad / 2)
      })
      .setLinearDamping(0.12)
      .setAngularDamping(3.5) // High angular damping prevents wild flipping/tumbling
      .setCanSleep(false);

    this.rigidBody = this.world.createRigidBody(rigidBodyDesc);

    // Create Chassis Box Collider
    const halfLength = specs.lengthMeters * 0.44;
    const halfWidth = specs.widthMeters * 0.40;
    const halfHeight = 0.18;
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfLength)
      .setMass(specs.massKg)
      .setFriction(0.2)
      .setRestitution(0.05);

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
    const hardpointHeight = 0.05;

    // In Chassis coordinates:
    // +Z is Forward, -Z is Rear
    // +X is Right, -X is Left
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
    let groundY = position.y;
    if (this.surfaceMap) {
      groundY = this.surfaceMap.sampleSurface(position.x, position.z).elevation;
    }

    const spawnY = groundY + this.wheelRadius + this.suspensionRestLength * 0.5;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);

    this.rigidBody.setTranslation({ x: position.x, y: spawnY, z: position.z }, true);
    this.rigidBody.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

    this.wheels.forEach(w => {
      w.angularVelocityRadS = 0;
      w.suspensionCompression = 0;
      w.normalLoadFz = (this.specs.massKg * 9.81) / 4;
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
    const upVec = new THREE.Vector3(0, 1, 0).applyQuaternion(chassisQuat).normalize();

    const localForwardSpeed = worldLinvel.dot(forwardVec);

    // Acceleration for G-meter
    const currentAccel = worldLinvel.clone().sub(this.lastLinearVelocity).divideScalar(dt);
    this.lastLinearVelocity.copy(worldLinvel);
    this.smoothedAcceleration.lerp(currentAccel, Math.min(1, dt * 15));

    // Speed-sensitive steering
    const speedKmh = Math.abs(localForwardSpeed * 3.6);
    const speedSteerFactor = Math.max(0.30, 1.0 - (speedKmh / 260) * 0.70);
    const targetSteerAngle = -this.steerInput * this.maxSteerAngleRad * speedSteerFactor;
    this.smoothedSteerAngle = THREE.MathUtils.lerp(this.smoothedSteerAngle, targetSteerAngle, Math.min(1, dt * 18));

    const totalMass = this.specs.massKg;
    const gravity = 9.81;
    const maxSuspensionForcePerWheel = totalMass * gravity * 1.5; // Safety clamp

    // Powertrain update
    const rearAvgAngVel = (this.wheels[2].angularVelocityRadS + this.wheels[3].angularVelocityRadS) * 0.5;
    const powertrainOut = this.powertrain.update(
      this.throttleInput,
      this.brakeInput,
      rearAvgAngVel,
      localForwardSpeed,
      dt
    );

    // 1. Process 4 Suspension Springs & Raycasts
    let groundedWheelCount = 0;

    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      const hardpointWorld = wheel.hardpointLocal.clone().applyQuaternion(chassisQuat).add(chassisPos);

      // Query Track Elevation at hardpoint (x, z)
      let groundElevation = 0;
      let groundNormal = new THREE.Vector3(0, 1, 0);
      let sampleResult = this.getDefaultSurfaceResult();

      if (this.surfaceMap) {
        sampleResult = this.surfaceMap.sampleSurface(hardpointWorld.x, hardpointWorld.z);
        groundElevation = sampleResult.elevation;
        groundNormal.copy(sampleResult.normal);
      }

      wheel.surfaceResult = sampleResult;

      // Distance from hardpoint down to ground
      const currentSuspensionLength = hardpointWorld.y - (groundElevation + this.wheelRadius);
      const isGrounded = currentSuspensionLength <= this.suspensionRestLength && currentSuspensionLength >= -0.20;

      wheel.isGrounded = isGrounded;

      if (isGrounded) {
        groundedWheelCount++;

        // Compression (0..maxTravel)
        const rawCompression = this.suspensionRestLength - currentSuspensionLength;
        const compression = Math.max(0, Math.min(this.suspensionMaxTravel, rawCompression));
        wheel.suspensionCompression = compression;

        // Wheel contact world position
        wheel.contactWorldPos.set(hardpointWorld.x, groundElevation + this.wheelRadius, hardpointWorld.z);

        // Suspension velocity using hardpoint motion along ground normal
        const rHardpoint = hardpointWorld.clone().sub(chassisPos);
        const hardpointVelocity = worldLinvel.clone().add(worldAngvel.clone().cross(rHardpoint));
        const suspensionCompVelocity = -hardpointVelocity.dot(groundNormal);

        // Spring + Damper Force
        wheel.springForceN = this.springStiffness * compression;
        wheel.damperForceN = this.damperRate * suspensionCompVelocity;

        const rawTotalSuspForce = wheel.springForceN + wheel.damperForceN;
        const totalSuspForce = Math.max(0, Math.min(maxSuspensionForcePerWheel, rawTotalSuspForce));
        wheel.normalLoadFz = totalSuspForce;

        // Apply upward suspension force at hardpoint
        const suspForceVec = groundNormal.clone().multiplyScalar(totalSuspForce);
        this.rigidBody.addForceAtPoint(
          { x: suspForceVec.x, y: suspForceVec.y, z: suspForceVec.z },
          { x: hardpointWorld.x, y: hardpointWorld.y, z: hardpointWorld.z },
          true
        );

        // Wheel Direction & Steering
        wheel.steerAngleRad = wheel.isFront ? this.smoothedSteerAngle : 0;
        const wheelHeadingQuat = chassisQuat.clone().multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wheel.steerAngleRad)
        );

        const wheelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(wheelHeadingQuat).normalize();
        const wheelRight = new THREE.Vector3(1, 0, 0).applyQuaternion(wheelHeadingQuat).normalize();

        // Contact patch velocity
        const wheelLongSpeed = hardpointVelocity.dot(wheelForward);
        const wheelLatSpeed = hardpointVelocity.dot(wheelRight);

        // Drive & Brake torques
        const driveTorque = !wheel.isFront ? powertrainOut.driveTorquePerRearWheelNm : 0;
        const brakeTorque = wheel.isFront ? powertrainOut.wheelBrakeTorqueFrontNm : powertrainOut.wheelBrakeTorqueRearNm;

        // Wheel angular acceleration
        const wheelInertia = 1.0;
        const netTorque = driveTorque - Math.sign(wheel.angularVelocityRadS || 1) * brakeTorque;
        wheel.angularVelocityRadS += (netTorque / wheelInertia) * dt;
        wheel.wheelLinearSpeedMs = wheel.angularVelocityRadS * this.wheelRadius;

        // Slip ratios
        const maxV = Math.max(0.6, Math.abs(wheelLongSpeed));
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

        // Apply tire planar traction force at hardpoint level
        const tireForceWorld = wheelForward.clone().multiplyScalar(wheel.tireForce.fx)
          .add(wheelRight.clone().multiplyScalar(wheel.tireForce.fy));

        // Rolling resistance & Gravel deceleration
        const rollingResist = -Math.sign(wheelLongSpeed) * (0.012 * wheel.normalLoadFz * sampleResult.surface.rollingDragMultiplier);
        tireForceWorld.add(wheelForward.clone().multiplyScalar(rollingResist));

        if (sampleResult.surface.decelerationPenalty > 0) {
          const gravelDecel = -Math.sign(wheelLongSpeed) * (totalMass * sampleResult.surface.decelerationPenalty * 0.25);
          tireForceWorld.add(wheelForward.clone().multiplyScalar(gravelDecel));
        }

        this.rigidBody.addForceAtPoint(
          { x: tireForceWorld.x, y: tireForceWorld.y, z: tireForceWorld.z },
          { x: hardpointWorld.x, y: hardpointWorld.y, z: hardpointWorld.z },
          true
        );

        // Anti-spin brake lock
        if (this.brakeInput > 0.2 && Math.abs(wheel.wheelLinearSpeedMs) < 0.3) {
          wheel.angularVelocityRadS = 0;
        }
      } else {
        // In the air
        wheel.suspensionCompression = 0;
        wheel.normalLoadFz = 0;
        wheel.tireForce = { fx: 0, fy: 0, slipAngleDeg: 0, slipRatio: 0, gripFraction: 0 };
        wheel.angularVelocityRadS *= Math.max(0, 1.0 - dt * 2.0);
      }
    }

    // 2. Anti-Roll Bar Coupling
    if (this.wheels[0].isGrounded && this.wheels[1].isGrounded) {
      const arbFront = (this.wheels[0].suspensionCompression - this.wheels[1].suspensionCompression) * this.antiRollBarStiffness;
      this.rigidBody.addForceAtPoint({ x: 0, y: -arbFront, z: 0 }, this.wheels[0].hardpointLocal.clone().applyQuaternion(chassisQuat).add(chassisPos), true);
      this.rigidBody.addForceAtPoint({ x: 0, y: arbFront, z: 0 }, this.wheels[1].hardpointLocal.clone().applyQuaternion(chassisQuat).add(chassisPos), true);
    }
    if (this.wheels[2].isGrounded && this.wheels[3].isGrounded) {
      const arbRear = (this.wheels[2].suspensionCompression - this.wheels[3].suspensionCompression) * this.antiRollBarStiffness;
      this.rigidBody.addForceAtPoint({ x: 0, y: -arbRear, z: 0 }, this.wheels[2].hardpointLocal.clone().applyQuaternion(chassisQuat).add(chassisPos), true);
      this.rigidBody.addForceAtPoint({ x: 0, y: arbRear, z: 0 }, this.wheels[3].hardpointLocal.clone().applyQuaternion(chassisQuat).add(chassisPos), true);
    }

    // 3. Aerodynamics (Downforce & Drag)
    const speed = worldLinvel.length();
    const speedSquared = speed * speed;
    const airDensity = 1.225;
    const downforceMagnitude = Math.min(totalMass * gravity * 2.0, 0.5 * airDensity * speedSquared * this.specs.downforceCoefficient * this.specs.frontalAreaM2);
    const dragMagnitude = 0.5 * airDensity * speedSquared * this.specs.dragCoefficient * this.specs.frontalAreaM2;

    if (downforceMagnitude > 0) {
      this.rigidBody.addForce({ x: 0, y: -downforceMagnitude, z: 0 }, true);
    }
    if (dragMagnitude > 0 && speed > 0.1) {
      const dragDir = worldLinvel.clone().normalize().negate();
      this.rigidBody.addForce({ x: dragDir.x * dragMagnitude, y: dragDir.y * dragMagnitude, z: dragDir.z * dragMagnitude }, true);
    }

    // 4. Anti-Roll / Upright Stabilization Force
    // Keeps the car naturally upright and stable on the ground
    const worldUp = new THREE.Vector3(0, 1, 0);
    const tiltCross = upVec.clone().cross(worldUp);
    const tiltAngle = upVec.angleTo(worldUp);

    if (tiltAngle > 0.05) {
      const stabilizingTorque = tiltCross.multiplyScalar(tiltAngle * totalMass * 18);
      this.rigidBody.addTorque({ x: stabilizingTorque.x, y: stabilizingTorque.y, z: stabilizingTorque.z }, true);
    }

    // 5. Safety velocity clamp (prevents physics explosions)
    const maxAllowedSpeed = (this.specs.topSpeedKmh / 3.6) * 1.15;
    const currentLinvel = this.rigidBody.linvel();
    const currentSpeed = Math.hypot(currentLinvel.x, currentLinvel.z);

    if (currentSpeed > maxAllowedSpeed) {
      const scale = maxAllowedSpeed / currentSpeed;
      this.rigidBody.setLinvel({ x: currentLinvel.x * scale, y: currentLinvel.y, z: currentLinvel.z * scale }, true);
    }

    // Clamp vertical velocity
    if (Math.abs(currentLinvel.y) > 25) {
      this.rigidBody.setLinvel({ x: currentLinvel.x, y: Math.sign(currentLinvel.y) * 25, z: currentLinvel.z }, true);
    }

    // Update interpolated transform buffer
    const nextTrans = this.rigidBody.translation();
    const nextRot = this.rigidBody.rotation();
    this.currPosition.set(nextTrans.x, nextTrans.y, nextTrans.z);
    this.currRotation.set(nextRot.x, nextRot.y, nextRot.z, nextRot.w);
  }

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
