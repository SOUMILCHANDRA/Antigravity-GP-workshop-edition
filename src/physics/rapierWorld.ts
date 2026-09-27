import RAPIER from '@dimforge/rapier3d-compat';

export interface PhysicsInterpolationState {
  translation: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  linvel: { x: number; y: number; z: number };
  angvel: { x: number; y: number; z: number };
}

export class RapierWorldManager {
  private static instance: RapierWorldManager | null = null;
  private isInitialized: boolean = false;
  private world: RAPIER.World | null = null;

  // Fixed 120 Hz Physics Substep (8.333 ms)
  public readonly physicsTimestep: number = 1 / 120;
  private accumulator: number = 0;
  private maxSubsteps: number = 6; // Safety clamp against spiral of death

  private constructor() {}

  public static getInstance(): RapierWorldManager {
    if (!RapierWorldManager.instance) {
      RapierWorldManager.instance = new RapierWorldManager();
    }
    return RapierWorldManager.instance;
  }

  public async init(): Promise<RAPIER.World> {
    if (this.isInitialized && this.world) {
      return this.world;
    }

    // Initialize WASM
    await RAPIER.init();

    // Standard Earth Gravity (Y is Up)
    const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
    this.world = new RAPIER.World(gravity);
    this.world.timestep = this.physicsTimestep;

    this.isInitialized = true;
    console.info('[RapierWorld] Physics Engine initialized @ 120Hz fixed timestep');
    return this.world;
  }

  public getWorld(): RAPIER.World {
    if (!this.world) {
      throw new Error('[RapierWorld] World not initialized. Call init() first.');
    }
    return this.world;
  }

  /**
   * Updates physics with fixed timestep accumulator pattern
   * @param deltaSeconds Frame delta time in seconds
   * @param stepCallback Callback invoked for every 1/120s sub-step
   * @returns Alpha value (0..1) for render frame lerp interpolation
   */
  public stepFixedTimestep(deltaSeconds: number, stepCallback: (dt: number) => void): number {
    if (!this.world) return 0;

    // Clamp deltaSeconds to prevent lag spikes causing hundreds of steps
    const clampedDelta = Math.min(deltaSeconds, 0.1);
    this.accumulator += clampedDelta;

    let substepCount = 0;
    while (this.accumulator >= this.physicsTimestep && substepCount < this.maxSubsteps) {
      // 1. Invoke custom sub-step forces (suspension, tire friction, aero, motor)
      stepCallback(this.physicsTimestep);

      // 2. Step Rapier physics world
      this.world.step();

      this.accumulator -= this.physicsTimestep;
      substepCount++;
    }

    // Return interpolation alpha between current and previous physics state
    return this.accumulator / this.physicsTimestep;
  }

  public reset(): void {
    if (this.world) {
      this.world.free();
      const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
      this.world = new RAPIER.World(gravity);
      this.world.timestep = this.physicsTimestep;
    }
    this.accumulator = 0;
  }
}

export const rapierWorldManager = RapierWorldManager.getInstance();
