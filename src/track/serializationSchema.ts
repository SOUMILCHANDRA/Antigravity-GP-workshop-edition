export interface StartFinishGateData {
  sampleIndex: number;          // Index on spline
  distanceAlongSpline: number;  // Meters from start
  position: { x: number; y: number; z: number };
  forwardVector: { x: number; y: number; z: number };
  width: number;
}

export interface TrackMetadata {
  id: string;
  name: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
  lapRecord?: {
    driver: string;
    timeMs: number;
    date: string;
  };
}

export interface SerializedControlPoint {
  id: string;
  pos: [number, number, number]; // [x, y, z]
  bankingDeg: number;
  width: number;
  kerbLeft?: boolean;
  kerbRight?: boolean;
  gravelLeftWidth?: number;
  gravelRightWidth?: number;
}

export interface SerializedTrackFile {
  schemaVersion: '1.0.0';
  metadata: TrackMetadata;
  config: {
    isClosed: boolean;
    defaultWidth: number;
  };
  startFinishGate: StartFinishGateData;
  points: SerializedControlPoint[];
}

export interface TrackValidationReport {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  stats: {
    pointCount: number;
    lengthMeters: number;
    isClosed: boolean;
    hasStartFinish: boolean;
    selfIntersectionCount: number;
  };
}
