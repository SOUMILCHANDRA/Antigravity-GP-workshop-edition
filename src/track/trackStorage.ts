import * as THREE from 'three';
import type { TrackData, TrackControlPoint } from './types';
import type {
  SerializedTrackFile,
  SerializedControlPoint,
  StartFinishGateData,
  TrackValidationReport
} from './serializationSchema';

export class TrackStorage {
  private static STORAGE_PREFIX = 'ag_track_';
  private static CATALOG_KEY = 'ag_track_catalog';

  // 1. Serialize TrackData to Clean JSON Schema
  public static serialize(
    trackData: TrackData,
    gateData: StartFinishGateData,
    author: string = 'Driver',
    description: string = 'Custom built Antigravity GP Circuit'
  ): SerializedTrackFile {
    const points: SerializedControlPoint[] = trackData.points.map(p => ({
      id: p.id,
      pos: [
        parseFloat(p.position.x.toFixed(2)),
        parseFloat(p.position.y.toFixed(2)),
        parseFloat(p.position.z.toFixed(2))
      ],
      bankingDeg: parseFloat(p.bankingDeg.toFixed(1)),
      width: parseFloat(p.width.toFixed(1)),
      kerbLeft: p.kerbLeft || false,
      kerbRight: p.kerbRight || false,
      gravelLeftWidth: p.gravelLeftWidth ? parseFloat(p.gravelLeftWidth.toFixed(1)) : 0,
      gravelRightWidth: p.gravelRightWidth ? parseFloat(p.gravelRightWidth.toFixed(1)) : 0
    }));

    const now = new Date().toISOString();

    return {
      schemaVersion: '1.0.0',
      metadata: {
        id: trackData.id,
        name: trackData.name,
        author,
        createdAt: now,
        updatedAt: now,
        description
      },
      config: {
        isClosed: trackData.isClosed,
        defaultWidth: trackData.defaultWidth
      },
      startFinishGate: gateData,
      points
    };
  }

  // 2. Deserialize & Reconstruct TrackData
  public static deserialize(serialized: SerializedTrackFile): {
    trackData: TrackData;
    gateData: StartFinishGateData;
    report: TrackValidationReport;
  } {
    const report = this.validate(serialized);

    const points: TrackControlPoint[] = serialized.points.map(p => ({
      id: p.id,
      position: new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
      bankingDeg: p.bankingDeg,
      width: p.width,
      kerbLeft: p.kerbLeft,
      kerbRight: p.kerbRight,
      gravelLeftWidth: p.gravelLeftWidth,
      gravelRightWidth: p.gravelRightWidth
    }));

    const trackData: TrackData = {
      id: serialized.metadata.id || `track_${Date.now()}`,
      name: serialized.metadata.name || 'Untitled Circuit',
      isClosed: serialized.config.isClosed,
      defaultWidth: serialized.config.defaultWidth || 13,
      points
    };

    return {
      trackData,
      gateData: serialized.startFinishGate,
      report
    };
  }

  // 3. Comprehensive Track Validator
  public static validate(file: SerializedTrackFile): TrackValidationReport {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!file.points || file.points.length < 3) {
      errors.push('Track must contain at least 3 control points to form a valid circuit.');
    }

    if (!file.config.isClosed) {
      warnings.push('Track is an open layout. A closed loop is recommended for standard circuit racing.');
    }

    if (!file.startFinishGate) {
      warnings.push('Start/Finish timing gate is missing. Defaulting to Point 0.');
    }

    // Check for self-intersections in 2D projection
    let intersectionCount = 0;
    const pts = file.points;
    const n = pts.length;

    if (n >= 4) {
      for (let i = 0; i < n; i++) {
        const p1 = pts[i].pos;
        const p2 = pts[(i + 1) % n].pos;

        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue; // Connected adjacent endpoints

          const p3 = pts[j].pos;
          const p4 = pts[(j + 1) % n].pos;

          if (this.doLineSegmentsIntersect(p1[0], p1[2], p2[0], p2[2], p3[0], p3[2], p4[0], p4[2])) {
            intersectionCount++;
          }
        }
      }
    }

    if (intersectionCount > 0) {
      warnings.push(`Detected ${intersectionCount} crossing/self-intersecting segment(s). Verify track layout or elevation overpasses.`);
    }

    // Compute approximate track length
    let lengthMeters = 0;
    for (let i = 0; i < n; i++) {
      if (!file.config.isClosed && i === n - 1) break;
      const pA = pts[i].pos;
      const pB = pts[(i + 1) % n].pos;
      const dx = pB[0] - pA[0];
      const dy = pB[1] - pA[1];
      const dz = pB[2] - pA[2];
      lengthMeters += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    return {
      isValid: errors.length === 0,
      warnings,
      errors,
      stats: {
        pointCount: n,
        lengthMeters: Math.round(lengthMeters),
        isClosed: file.config.isClosed,
        hasStartFinish: !!file.startFinishGate,
        selfIntersectionCount: intersectionCount
      }
    };
  }

  private static doLineSegmentsIntersect(
    p0_x: number, p0_y: number, p1_x: number, p1_y: number,
    p2_x: number, p2_y: number, p3_x: number, p3_y: number
  ): boolean {
    const s1_x = p1_x - p0_x;
    const s1_y = p1_y - p0_y;
    const s2_x = p3_x - p2_x;
    const s2_y = p3_y - p2_y;

    const s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / (-s2_x * s1_y + s1_x * s2_y);
    const t = ( s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / (-s2_x * s1_y + s1_x * s2_y);

    return (s > 0.02 && s < 0.98 && t > 0.02 && t < 0.98);
  }

  // 4. LocalStorage Management
  public static saveToLocalStorage(serialized: SerializedTrackFile): void {
    const key = `${this.STORAGE_PREFIX}${serialized.metadata.id}`;
    localStorage.setItem(key, JSON.stringify(serialized));

    // Update catalog index
    const catalog = this.getCatalog();
    const existingIdx = catalog.findIndex(c => c.id === serialized.metadata.id);
    const entry = {
      id: serialized.metadata.id,
      name: serialized.metadata.name,
      updatedAt: serialized.metadata.updatedAt,
      pointCount: serialized.points.length
    };

    if (existingIdx >= 0) {
      catalog[existingIdx] = entry;
    } else {
      catalog.push(entry);
    }

    localStorage.setItem(this.CATALOG_KEY, JSON.stringify(catalog));
    console.info(`[TrackStorage] Saved track "${serialized.metadata.name}" to localStorage (${key})`);
  }

  public static loadFromLocalStorage(id: string): SerializedTrackFile | null {
    const key = `${this.STORAGE_PREFIX}${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SerializedTrackFile;
    } catch (e) {
      console.error(`[TrackStorage] Failed to parse track from localStorage:`, e);
      return null;
    }
  }

  public static getCatalog(): Array<{ id: string; name: string; updatedAt: string; pointCount: number }> {
    const raw = localStorage.getItem(this.CATALOG_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // 5. Native File Export & Import
  public static exportToFile(serialized: SerializedTrackFile): void {
    const jsonStr = JSON.stringify(serialized, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sanitizedName = serialized.metadata.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    a.download = `${sanitizedName}_circuit.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.info(`[TrackStorage] Exported "${serialized.metadata.name}" as JSON file.`);
  }

  public static async importFromFile(file: File): Promise<SerializedTrackFile> {
    const text = await file.text();
    const parsed = JSON.parse(text) as SerializedTrackFile;
    if (!parsed.points || !parsed.config) {
      throw new Error('Invalid track JSON file format: missing points or config.');
    }
    return parsed;
  }

  // 6. Built-in Iconic Track Presets
  public static getPresetTracks(): SerializedTrackFile[] {
    return [
      {
        schemaVersion: '1.0.0',
        metadata: {
          id: 'preset_autodromo_antigravita',
          name: 'Autodromo Antigravita',
          author: 'Studio AG',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          description: 'Official test circuit featuring sweeping turns, crest apex, and technical hairpin.'
        },
        config: { isClosed: true, defaultWidth: 13 },
        startFinishGate: {
          sampleIndex: 0,
          distanceAlongSpline: 0,
          position: { x: -50, y: 0, z: -40 },
          forwardVector: { x: 1, y: 0, z: 0 },
          width: 13
        },
        points: [
          { id: 'p0', pos: [-50, 0, -40], bankingDeg: 0, width: 13, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 'p1', pos: [0, 0, -40], bankingDeg: 0, width: 13, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 'p2', pos: [50, 0, -40], bankingDeg: 5, width: 13, kerbLeft: false, kerbRight: true, gravelLeftWidth: 12, gravelRightWidth: 0 },
          { id: 'p3', pos: [75, 4, -10], bankingDeg: 15, width: 13, kerbLeft: false, kerbRight: true, gravelLeftWidth: 16, gravelRightWidth: 0 },
          { id: 'p4', pos: [65, 6, 25], bankingDeg: 12, width: 13, kerbLeft: false, kerbRight: true, gravelLeftWidth: 14, gravelRightWidth: 0 },
          { id: 'p5', pos: [30, 3, 45], bankingDeg: 0, width: 13, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 8 },
          { id: 'p6', pos: [-20, 0, 45], bankingDeg: 0, width: 13, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 'p7', pos: [-60, 2, 35], bankingDeg: -10, width: 13, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 15 },
          { id: 'p8', pos: [-75, 0, 10], bankingDeg: -12, width: 13, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 16 },
          { id: 'p9', pos: [-65, 0, -20], bankingDeg: -5, width: 13, kerbLeft: false, kerbRight: true, gravelLeftWidth: 10, gravelRightWidth: 0 }
        ]
      },
      {
        schemaVersion: '1.0.0',
        metadata: {
          id: 'preset_monza_speedway',
          name: 'Monza Classic High-Speed',
          author: 'Autodromo Nazionale',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          description: 'High-speed temple of speed with Variante del Rettifilo, Curva Grande, and Parabolica.'
        },
        config: { isClosed: true, defaultWidth: 14 },
        startFinishGate: {
          sampleIndex: 0,
          distanceAlongSpline: 0,
          position: { x: -80, y: 0, z: -60 },
          forwardVector: { x: 1, y: 0, z: 0 },
          width: 14
        },
        points: [
          { id: 'm0', pos: [-80, 0, -60], bankingDeg: 0, width: 14, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 'm1', pos: [20, 0, -60], bankingDeg: 0, width: 14, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 'm2', pos: [70, 0, -60], bankingDeg: 4, width: 14, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 14 },
          { id: 'm3', pos: [85, 0, -35], bankingDeg: 8, width: 14, kerbLeft: false, kerbRight: true, gravelLeftWidth: 14, gravelRightWidth: 0 },
          { id: 'm4', pos: [90, 0, 30], bankingDeg: 10, width: 14, kerbLeft: false, kerbRight: true, gravelLeftWidth: 18, gravelRightWidth: 0 },
          { id: 'm5', pos: [40, 1, 65], bankingDeg: 0, width: 14, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 12 },
          { id: 'm6', pos: [-40, 0, 65], bankingDeg: 0, width: 14, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 'm7', pos: [-85, 0, 40], bankingDeg: -12, width: 14, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 20 },
          { id: 'm8', pos: [-95, 0, -10], bankingDeg: -14, width: 14, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 20 }
        ]
      },
      {
        schemaVersion: '1.0.0',
        metadata: {
          id: 'preset_spa_eau_rouge',
          name: 'Ardennes Rollercoaster (Spa Style)',
          author: 'Circuit de Spa',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          description: 'Dramatic downhill compression into massive uphill Raidillon crest and sweeping forest turns.'
        },
        config: { isClosed: true, defaultWidth: 13 },
        startFinishGate: {
          sampleIndex: 0,
          distanceAlongSpline: 0,
          position: { x: -60, y: 15, z: -50 },
          forwardVector: { x: 1, y: 0, z: 0 },
          width: 13
        },
        points: [
          { id: 's0', pos: [-60, 15, -50], bankingDeg: 0, width: 13, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 's1', pos: [-20, 8, -50], bankingDeg: 0, width: 13, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 's2', pos: [15, 0, -45], bankingDeg: 12, width: 13, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 10 },
          { id: 's3', pos: [35, 12, -30], bankingDeg: -18, width: 13, kerbLeft: false, kerbRight: true, gravelLeftWidth: 18, gravelRightWidth: 0 },
          { id: 's4', pos: [45, 24, 0], bankingDeg: 0, width: 13, kerbLeft: true, kerbRight: true, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 's5', pos: [55, 26, 45], bankingDeg: 8, width: 13, kerbLeft: false, kerbRight: true, gravelLeftWidth: 15, gravelRightWidth: 0 },
          { id: 's6', pos: [10, 20, 65], bankingDeg: 0, width: 13, kerbLeft: false, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 0 },
          { id: 's7', pos: [-45, 18, 55], bankingDeg: -10, width: 13, kerbLeft: true, kerbRight: false, gravelLeftWidth: 0, gravelRightWidth: 16 },
          { id: 's8', pos: [-75, 16, 15], bankingDeg: 0, width: 13, kerbLeft: false, kerbRight: true, gravelLeftWidth: 10, gravelRightWidth: 0 }
        ]
      }
    ];
  }
}
