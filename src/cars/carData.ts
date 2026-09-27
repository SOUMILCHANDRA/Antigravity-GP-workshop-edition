import { QualityTier } from '../core/types';

export interface CarSpecs {
  id: string;
  name: string;
  year: number;
  era: '1960s_v12' | '1970s_ground_effect' | '1980s_turbo_na';
  livery: string;
  historicalNote: string;

  // Physical Dimensions & Mass (meters & kg)
  massKg: number;
  wheelbaseMeters: number;
  frontTrackMeters: number;
  rearTrackMeters: number;
  lengthMeters: number;
  widthMeters: number;
  heightMeters: number;
  centerOfGravityHeightMeters: number; // Period technical estimate (~0.28m - 0.32m)
  weightDistributionFrontRatio: number; // Front:Rear e.g. 0.42 : 0.58

  // Powertrain Specs
  engineDescription: string;
  engineDisplacementL: number;
  engineCylinders: number;
  peakHorsepower: number;
  peakHpRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  maxRpm: number;
  idleRpm: number;
  gearCount: number;
  topSpeedKmh: number; // Sanity check benchmark figure

  // Aerodynamics & Tires
  dragCoefficient: number; // Period open wheelers ~0.85 - 1.15
  frontalAreaM2: number;
  downforceCoefficient: number; // Low for 1967, moderate for 1972, high for 1989
  tireType: 'crossply_vintage' | 'biasply_slick' | 'radial_slick';

  // 3D Model Assets & Alignment
  models: Record<QualityTier, string>;
  modelRotationY?: number; // Radians to align model nose with chassis forward vector (+X)
}

export const CAR_ROSTER: Record<string, CarSpecs> = {
  ferrari_312: {
    id: 'ferrari_312',
    name: 'Ferrari 312 F1-67',
    year: 1967,
    era: '1960s_v12',
    livery: 'Scuderia Ferrari #18 (Rosso Corsa)',
    historicalNote: 'The iconic Colombo-derived 3.0L V12 screaming open-wheeler with Spaghetti exhaust headers.',
    massKg: 530, // 1967 lightened mid-season spec (~500–548 kg)
    wheelbaseMeters: 2.40,
    frontTrackMeters: 1.45,
    rearTrackMeters: 1.47,
    lengthMeters: 3.83,
    widthMeters: 1.52,
    heightMeters: 0.87,
    centerOfGravityHeightMeters: 0.30, // Period estimate
    weightDistributionFrontRatio: 0.42, // Rear-biased engine
    engineDescription: 'Ferrari Tipo 242 3.0L 60° V12 NA',
    engineDisplacementL: 3.0,
    engineCylinders: 12,
    peakHorsepower: 390,
    peakHpRpm: 10000,
    peakTorqueNm: 310,
    peakTorqueRpm: 8200,
    maxRpm: 10500,
    idleRpm: 2200,
    gearCount: 5,
    topSpeedKmh: 310,
    dragCoefficient: 0.92, // Exposed suspension & high headers
    frontalAreaM2: 1.25,
    downforceCoefficient: 0.05, // Cigar era, essentially negligible downforce
    tireType: 'crossply_vintage',
    modelRotationY: 0,
    models: {
      [QualityTier.High]: '/models/normalized/ferrari_312_high.glb',
      [QualityTier.Medium]: '/models/normalized/ferrari_312_medium.glb',
      [QualityTier.Low]: '/models/normalized/ferrari_312_low.glb'
    }
  },
  lotus_72d: {
    id: 'lotus_72d',
    name: 'Lotus 72D',
    year: 1972,
    era: '1970s_ground_effect',
    livery: 'John Player Special #8 (Black & Gold)',
    historicalNote: 'Colin Chapman masterpiece featuring wedge aerodynamics, inboard brakes, and side radiators.',
    massKg: 540,
    wheelbaseMeters: 2.54,
    frontTrackMeters: 1.49,
    rearTrackMeters: 1.57,
    lengthMeters: 4.19,
    widthMeters: 2.10,
    heightMeters: 1.17,
    centerOfGravityHeightMeters: 0.28,
    weightDistributionFrontRatio: 0.40,
    engineDescription: 'Ford-Cosworth DFV 3.0L 90° V8 NA',
    engineDisplacementL: 3.0,
    engineCylinders: 8,
    peakHorsepower: 440,
    peakHpRpm: 10000,
    peakTorqueNm: 360,
    peakTorqueRpm: 7500,
    maxRpm: 10500,
    idleRpm: 2000,
    gearCount: 5,
    topSpeedKmh: 320,
    dragCoefficient: 0.88,
    frontalAreaM2: 1.35,
    downforceCoefficient: 0.35, // Wing-era downforce
    tireType: 'biasply_slick',
    modelRotationY: 0,
    models: {
      [QualityTier.High]: '/models/normalized/lotus_72d_high.glb',
      [QualityTier.Medium]: '/models/normalized/lotus_72d_medium.glb',
      [QualityTier.Low]: '/models/normalized/lotus_72d_low.glb'
    }
  },
  mclaren_mp45: {
    id: 'mclaren_mp45',
    name: 'McLaren MP4/5',
    year: 1989,
    era: '1980s_turbo_na',
    livery: 'Marlboro McLaren Honda #1 (Senna / Prost)',
    historicalNote: 'Dominant 1989 Constructors Championship car powered by the screaming 3.5L Honda V10.',
    massKg: 505, // 1989 regulation minimum
    wheelbaseMeters: 2.90,
    frontTrackMeters: 1.82,
    rearTrackMeters: 1.67,
    lengthMeters: 4.40,
    widthMeters: 2.15,
    heightMeters: 1.00,
    centerOfGravityHeightMeters: 0.26,
    weightDistributionFrontRatio: 0.43,
    engineDescription: 'Honda RA109E 3.5L 72° V10 NA',
    engineDisplacementL: 3.5,
    engineCylinders: 10,
    peakHorsepower: 685,
    peakHpRpm: 13000,
    peakTorqueNm: 410,
    peakTorqueRpm: 10500,
    maxRpm: 14000,
    idleRpm: 3500,
    gearCount: 6,
    topSpeedKmh: 345,
    dragCoefficient: 0.82,
    frontalAreaM2: 1.40,
    downforceCoefficient: 0.85, // High downforce aero package
    tireType: 'radial_slick',
    modelRotationY: 0,
    models: {
      [QualityTier.High]: '/models/normalized/mclaren_mp45_high.glb',
      [QualityTier.Medium]: '/models/normalized/mclaren_mp45_medium.glb',
      [QualityTier.Low]: '/models/normalized/mclaren_mp45_low.glb'
    }
  }
};
