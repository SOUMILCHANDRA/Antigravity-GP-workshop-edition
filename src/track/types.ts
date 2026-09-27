import * as THREE from 'three';
import type { SurfaceProperties } from './surfaceTypes';

export interface TrackControlPoint {
  id: string;
  position: THREE.Vector3; // x, y (elevation), z
  bankingDeg: number;      // Roll angle in degrees (positive = bank right/inwards, negative = bank left)
  width: number;           // Track width in meters at this point
  kerbLeft?: boolean;      // Striped apex kerb on left side
  kerbRight?: boolean;     // Striped apex kerb on right side
  gravelLeftWidth?: number; // Gravel runoff trap width on left (meters, 0-25m)
  gravelRightWidth?: number; // Gravel runoff trap width on right (meters, 0-25m)
}

export interface TrackData {
  id: string;
  name: string;
  isClosed: boolean;
  defaultWidth: number;
  points: TrackControlPoint[];
}

export interface TrackSplineSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;     // Banked up-vector
  binormal: THREE.Vector3;   // Banked cross-track vector
  leftPoint: THREE.Vector3;
  rightPoint: THREE.Vector3;
  bankingRad: number;
  width: number;
  distance: number;
  u: number;

  // Surface zones
  kerbLeftWidth: number;     // 0 if none, ~1.0m if enabled
  kerbRightWidth: number;    // 0 if none, ~1.0m if enabled
  gravelLeftWidth: number;   // 0 if none, e.g. 6-18m
  gravelRightWidth: number;  // 0 if none, e.g. 6-18m
  leftKerbOuterPoint?: THREE.Vector3;
  rightKerbOuterPoint?: THREE.Vector3;
  leftGravelOuterPoint?: THREE.Vector3;
  rightGravelOuterPoint?: THREE.Vector3;
}

export type EditorTool = 'add' | 'select' | 'elevation' | 'banking' | 'kerbs' | 'gravel' | 'gate' | 'delete';

export interface EditorState {
  activeTool: EditorTool;
  selectedPointId: string | null;
  hoveredPointId: string | null;
  isTopDown: boolean;
  gridSnap: boolean;
  snapGridSize: number;
  testDriveMode: boolean;
}

export interface SurfaceSampleResult {
  surface: SurfaceProperties;
  elevation: number;
  normal: THREE.Vector3;
  distanceToCenterline: number;
  trackWidthAtPoint: number;
  isInsideTrackBounds: boolean;
}
