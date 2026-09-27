import * as THREE from 'three';
import { SURFACE_PROPERTIES } from './surfaceTypes';
import type { TrackSplineSample, SurfaceSampleResult } from './types';

interface SpatialCell {
  sampleIndices: number[];
}

export class SurfaceMap {
  private samples: TrackSplineSample[];
  private cellSize: number = 8; // 8 meter spatial bins
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
      const maxW = (s.width / 2) + Math.max(s.gravelLeftWidth, s.gravelRightWidth) + 8;

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

  /**
   * Sub-microsecond exact spatial query determining surface type and elevation
   */
  public sampleSurface(x: number, z: number): SurfaceSampleResult {
    const n = this.samples.length;
    if (n < 2) {
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

    let closestIdx = 0;
    let minDistanceSq = Infinity;

    if (candidateIndices && candidateIndices.length > 0) {
      for (let i = 0; i < candidateIndices.length; i++) {
        const idx = candidateIndices[i];
        const s = this.samples[idx];
        const dx = s.position.x - x;
        const dz = s.position.z - z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistanceSq) {
          minDistanceSq = dSq;
          closestIdx = idx;
        }
      }
    } else {
      // Global fallback
      for (let i = 0; i < n; i++) {
        const s = this.samples[i];
        const dx = s.position.x - x;
        const dz = s.position.z - z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistanceSq) {
          minDistanceSq = dSq;
          closestIdx = i;
        }
      }
    }

    // Evaluate segment projection with adjacent neighbors
    const prevIdx = (closestIdx - 1 + n) % n;
    const nextIdx = (closestIdx + 1) % n;

    // Check segment A: [prev, closest] and segment B: [closest, next]
    const segA = this.projectOnSegment(x, z, this.samples[prevIdx], this.samples[closestIdx]);
    const segB = this.projectOnSegment(x, z, this.samples[closestIdx], this.samples[nextIdx]);

    const best = segA.distanceSq < segB.distanceSq ? segA : segB;
    const halfWidth = best.width / 2;
    const absLateral = Math.sqrt(best.distanceSq);

    const kerbWidth = best.isRight ? best.kerbRightWidth : best.kerbLeftWidth;
    const gravelWidth = best.isRight ? best.gravelRightWidth : best.gravelLeftWidth;

    // Surface classification
    if (absLateral <= halfWidth) {
      // On Tarmac
      return {
        surface: SURFACE_PROPERTIES.tarmac,
        elevation: best.elevation,
        normal: best.normal,
        distanceToCenterline: absLateral,
        trackWidthAtPoint: best.width,
        isInsideTrackBounds: true
      };
    } else if (kerbWidth > 0 && absLateral <= halfWidth + kerbWidth) {
      // On Apex Kerb (raised slightly)
      return {
        surface: SURFACE_PROPERTIES.kerb,
        elevation: best.elevation + 0.04,
        normal: best.normal,
        distanceToCenterline: absLateral,
        trackWidthAtPoint: best.width + kerbWidth * 2,
        isInsideTrackBounds: true
      };
    } else if (gravelWidth > 0 && absLateral <= halfWidth + kerbWidth + gravelWidth) {
      // In Gravel Trap (slightly sunken)
      return {
        surface: SURFACE_PROPERTIES.gravel,
        elevation: Math.max(0, best.elevation - 0.03),
        normal: new THREE.Vector3(0, 1, 0),
        distanceToCenterline: absLateral,
        trackWidthAtPoint: best.width + (kerbWidth + gravelWidth) * 2,
        isInsideTrackBounds: false
      };
    } else {
      // Off-Track Grass / Ground Plane
      const excessDist = absLateral - (halfWidth + kerbWidth + gravelWidth);
      const blend = Math.max(0, 1.0 - (excessDist / 2.5));
      const offTrackElevation = best.elevation * blend;

      return {
        surface: SURFACE_PROPERTIES.offtrack,
        elevation: Math.max(0, offTrackElevation),
        normal: new THREE.Vector3(0, 1, 0),
        distanceToCenterline: absLateral,
        trackWidthAtPoint: best.width,
        isInsideTrackBounds: false
      };
    }
  }

  private projectOnSegment(
    qx: number,
    qz: number,
    s0: TrackSplineSample,
    s1: TrackSplineSample
  ) {
    const vx = s1.position.x - s0.position.x;
    const vz = s1.position.z - s0.position.z;
    const lenSq = vx * vx + vz * vz;

    let t = 0;
    if (lenSq > 1e-6) {
      t = Math.max(0, Math.min(1, ((qx - s0.position.x) * vx + (qz - s0.position.z) * vz) / lenSq));
    }

    const projX = s0.position.x + t * vx;
    const projZ = s0.position.z + t * vz;
    const dx = qx - projX;
    const dz = qz - projZ;
    const distanceSq = dx * dx + dz * dz;

    const elevation = s0.position.y + t * (s1.position.y - s0.position.y);
    const width = s0.width + t * (s1.width - s0.width);
    const kerbLeftWidth = s0.kerbLeftWidth + t * (s1.kerbLeftWidth - s0.kerbLeftWidth);
    const kerbRightWidth = s0.kerbRightWidth + t * (s1.kerbRightWidth - s0.kerbRightWidth);
    const gravelLeftWidth = s0.gravelLeftWidth + t * (s1.gravelLeftWidth - s0.gravelLeftWidth);
    const gravelRightWidth = s0.gravelRightWidth + t * (s1.gravelRightWidth - s0.gravelRightWidth);

    // Cross product to determine Left / Right side
    const crossZ = vx * dz - vz * dx;
    const isRight = crossZ >= 0;

    const normal = s0.normal.clone().lerp(s1.normal, t).normalize();

    return {
      distanceSq,
      elevation,
      width,
      kerbLeftWidth,
      kerbRightWidth,
      gravelLeftWidth,
      gravelRightWidth,
      isRight,
      normal
    };
  }
}
