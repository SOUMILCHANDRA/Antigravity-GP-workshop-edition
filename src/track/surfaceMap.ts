import * as THREE from 'three';
import { SURFACE_PROPERTIES } from './surfaceTypes';
import type { TrackSplineSample, SurfaceSampleResult } from './types';

interface SpatialCell {
  sampleIndices: number[];
}

export class SurfaceMap {
  private samples: TrackSplineSample[];
  private cellSize: number = 10; // 10 meter spatial grid bins
  private grid: Map<string, SpatialCell> = new Map();

  constructor(samples: TrackSplineSample[], _isClosed: boolean = true) {
    this.samples = samples;
    this.buildSpatialGrid();
  }

  private getKey(x: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx}:${cz}`;
  }

  private buildSpatialGrid(): void {
    this.grid.clear();
    if (this.samples.length === 0) return;

    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      const maxW = (s.width / 2) + Math.max(s.gravelLeftWidth, s.gravelRightWidth) + 5;

      const minX = Math.floor((s.position.x - maxW) / this.cellSize);
      const maxX = Math.floor((s.position.x + maxW) / this.cellSize);
      const minZ = Math.floor((s.position.z - maxW) / this.cellSize);
      const maxZ = Math.floor((s.position.z + maxW) / this.cellSize);

      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const key = `${cx}:${cz}`;
          let cell = this.grid.get(key);
          if (!cell) {
            cell = { sampleIndices: [] };
            this.grid.set(key, cell);
          }
          cell.sampleIndices.push(i);
        }
      }
    }
  }

  public sampleSurface(x: number, z: number): SurfaceSampleResult {
    if (this.samples.length === 0) {
      return {
        surface: SURFACE_PROPERTIES.offtrack,
        elevation: 0,
        normal: new THREE.Vector3(0, 1, 0),
        distanceToCenterline: 999,
        trackWidthAtPoint: 12,
        isInsideTrackBounds: false
      };
    }

    const key = this.getKey(x, z);
    const cell = this.grid.get(key);
    const candidateIndices = cell ? cell.sampleIndices : null;

    let closestSampleIdx = 0;
    let minDistanceSq = Infinity;

    // Search closest slice along spline
    if (candidateIndices && candidateIndices.length > 0) {
      for (const idx of candidateIndices) {
        const s = this.samples[idx];
        const dx = s.position.x - x;
        const dz = s.position.z - z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistanceSq) {
          minDistanceSq = dSq;
          closestSampleIdx = idx;
        }
      }
    } else {
      // Fallback brute force
      for (let i = 0; i < this.samples.length; i++) {
        const s = this.samples[i];
        const dx = s.position.x - x;
        const dz = s.position.z - z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistanceSq) {
          minDistanceSq = dSq;
          closestSampleIdx = i;
        }
      }
    }

    const s = this.samples[closestSampleIdx];

    // Vector from sample position to query point in horizontal plane
    const toQuery = new THREE.Vector3(x - s.position.x, 0, z - s.position.z);

    // Project onto cross-track binormal
    const binormalH = new THREE.Vector3(s.binormal.x, 0, s.binormal.z).normalize();
    const lateralOffset = toQuery.dot(binormalH); // Positive = right side, Negative = left side
    const absLateral = Math.abs(lateralOffset);

    const halfWidth = s.width / 2;
    const isRight = lateralOffset >= 0;

    const kerbWidth = isRight ? s.kerbRightWidth : s.kerbLeftWidth;
    const gravelWidth = isRight ? s.gravelRightWidth : s.gravelLeftWidth;

    // Calculate interpolated elevation on banked plane
    const pointElevation = s.position.y + lateralOffset * (s.binormal.y / (Math.abs(s.binormal.x) + Math.abs(s.binormal.z) || 1));

    // Determine surface type based on lateral distance
    if (absLateral <= halfWidth) {
      // Tarmac main track
      return {
        surface: SURFACE_PROPERTIES.tarmac,
        elevation: pointElevation,
        normal: s.normal.clone(),
        distanceToCenterline: absLateral,
        trackWidthAtPoint: s.width,
        isInsideTrackBounds: true
      };
    } else if (kerbWidth > 0 && absLateral <= halfWidth + kerbWidth) {
      // Apex Kerb (raised slightly)
      return {
        surface: SURFACE_PROPERTIES.kerb,
        elevation: pointElevation + 0.05,
        normal: s.normal.clone(),
        distanceToCenterline: absLateral,
        trackWidthAtPoint: s.width + kerbWidth * 2,
        isInsideTrackBounds: true
      };
    } else if (gravelWidth > 0 && absLateral <= halfWidth + kerbWidth + gravelWidth) {
      // Gravel Runoff Trap
      return {
        surface: SURFACE_PROPERTIES.gravel,
        elevation: Math.max(0, pointElevation - 0.04), // slightly sunken gravel bed
        normal: new THREE.Vector3(0, 1, 0),
        distanceToCenterline: absLateral,
        trackWidthAtPoint: s.width + (kerbWidth + gravelWidth) * 2,
        isInsideTrackBounds: false
      };
    } else {
      // Off-track / Grass / Ground plane
      return {
        surface: SURFACE_PROPERTIES.offtrack,
        elevation: Math.max(0, pointElevation),
        normal: new THREE.Vector3(0, 1, 0),
        distanceToCenterline: absLateral,
        trackWidthAtPoint: s.width,
        isInsideTrackBounds: false
      };
    }
  }
}
