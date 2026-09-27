export type SurfaceType = 'tarmac' | 'kerb' | 'gravel' | 'offtrack';

export interface SurfaceProperties {
  type: SurfaceType;
  name: string;
  frictionMultiplier: number;
  rollingDragMultiplier: number;
  decelerationPenalty: number; // Extra drag force in m/s^2
  isDrivable: boolean;
  colorHex: number;
}

export const SURFACE_PROPERTIES: Record<SurfaceType, SurfaceProperties> = {
  tarmac: {
    type: 'tarmac',
    name: 'Tarmac (Track)',
    frictionMultiplier: 1.0,
    rollingDragMultiplier: 1.0,
    decelerationPenalty: 0.0,
    isDrivable: true,
    colorHex: 0x22262e
  },
  kerb: {
    type: 'kerb',
    name: 'Apex Kerb',
    frictionMultiplier: 0.88,
    rollingDragMultiplier: 1.25,
    decelerationPenalty: 0.5,
    isDrivable: true,
    colorHex: 0xef233c
  },
  gravel: {
    type: 'gravel',
    name: 'Gravel Runoff',
    frictionMultiplier: 0.42,
    rollingDragMultiplier: 5.5,
    decelerationPenalty: 16.0,
    isDrivable: false,
    colorHex: 0xc2a677
  },
  offtrack: {
    type: 'offtrack',
    name: 'Grass / Off-Track',
    frictionMultiplier: 0.35,
    rollingDragMultiplier: 3.8,
    decelerationPenalty: 10.0,
    isDrivable: false,
    colorHex: 0x18281a
  }
};

export interface WheelSurfaceContact {
  wheelIndex: number;
  wheelName: 'FL' | 'FR' | 'RL' | 'RR';
  worldPosition: { x: number; y: number; z: number };
  surface: SurfaceProperties;
  isOffTrack: boolean;
}
