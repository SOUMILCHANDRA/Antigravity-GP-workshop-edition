import * as THREE from 'three';
import type { TrackControlPoint, TrackSplineSample } from './types';
import { SurfaceMap } from './surfaceMap';

export interface GeneratedTrackMesh {
  roadMesh: THREE.Mesh;
  kerbMesh: THREE.Mesh | null;
  gravelMesh: THREE.Mesh | null;
  substructureMesh: THREE.Mesh;
  centerlineLine: THREE.Line;
  samples: TrackSplineSample[];
  surfaceMap: SurfaceMap;
  totalLengthMeters: number;
  maxElevation: number;
  minElevation: number;
  maxBankingDeg: number;
}

export class TrackGenerator {
  public static generateTrack(
    points: TrackControlPoint[],
    isClosed: boolean,
    samplesPerMeter: number = 0.8
  ): GeneratedTrackMesh | null {
    if (points.length < (isClosed ? 3 : 2)) {
      return null;
    }

    const positions = points.map(p => p.position.clone());
    const curve = new THREE.CatmullRomCurve3(positions, isClosed, 'centripetal', 0.5);
    const totalLength = curve.getLength();

    const numSamples = Math.max(60, Math.min(1200, Math.round(totalLength * samplesPerMeter)));
    const samples: TrackSplineSample[] = [];

    let minElevation = Infinity;
    let maxElevation = -Infinity;
    let maxBankingDeg = 0;

    // Sample spline
    const stepCount = isClosed ? numSamples : numSamples - 1;
    for (let i = 0; i <= stepCount; i++) {
      const u = isClosed ? (i % numSamples) / numSamples : i / (numSamples - 1);
      const position = curve.getPointAt(u);
      const tangent = curve.getTangentAt(u).normalize();
      const distance = u * totalLength;

      minElevation = Math.min(minElevation, position.y);
      maxElevation = Math.max(maxElevation, position.y);

      // Interpolate point attributes (banking, width, kerbs, gravel)
      const attr = this.interpolatePointAttributes(points, u, isClosed);
      maxBankingDeg = Math.max(maxBankingDeg, Math.abs(attr.bankingDeg));
      const bankingRad = THREE.MathUtils.degToRad(attr.bankingDeg);

      // Frenet Frame
      const globalUp = new THREE.Vector3(0, 1, 0);
      let binormal = new THREE.Vector3().crossVectors(tangent, globalUp);

      if (binormal.lengthSq() < 0.0001) {
        binormal.set(1, 0, 0);
      } else {
        binormal.normalize();
      }

      let normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

      // Apply banking angle roll
      if (Math.abs(bankingRad) > 0.0001) {
        const bankQuat = new THREE.Quaternion().setFromAxisAngle(tangent, bankingRad);
        binormal.applyQuaternion(bankQuat).normalize();
        normal.applyQuaternion(bankQuat).normalize();
      }

      const halfWidth = attr.width / 2;
      const leftPoint = position.clone().addScaledVector(binormal, -halfWidth);
      const rightPoint = position.clone().addScaledVector(binormal, halfWidth);

      // Kerb outer points
      const leftKerbOuterPoint = leftPoint.clone().addScaledVector(binormal, -attr.kerbLeftWidth).addScaledVector(normal, 0.04);
      const rightKerbOuterPoint = rightPoint.clone().addScaledVector(binormal, attr.kerbRightWidth).addScaledVector(normal, 0.04);

      // Gravel outer points
      const leftGravelOuterPoint = leftKerbOuterPoint.clone().addScaledVector(binormal, -attr.gravelLeftWidth).addScaledVector(normal, -0.05);
      const rightGravelOuterPoint = rightKerbOuterPoint.clone().addScaledVector(binormal, attr.gravelRightWidth).addScaledVector(normal, -0.05);

      samples.push({
        position,
        tangent,
        normal,
        binormal,
        leftPoint,
        rightPoint,
        bankingRad,
        width: attr.width,
        distance,
        u,
        kerbLeftWidth: attr.kerbLeftWidth,
        kerbRightWidth: attr.kerbRightWidth,
        gravelLeftWidth: attr.gravelLeftWidth,
        gravelRightWidth: attr.gravelRightWidth,
        leftKerbOuterPoint,
        rightKerbOuterPoint,
        leftGravelOuterPoint,
        rightGravelOuterPoint
      });
    }

    // Build Road Surface Geometry
    const roadGeo = this.buildRoadGeometry(samples, isClosed);
    const roadMat = this.createRoadMaterial();
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    roadMesh.castShadow = true;

    // Build Kerb Geometry (Striped Red & White)
    const kerbGeo = this.buildKerbGeometry(samples, isClosed);
    let kerbMesh: THREE.Mesh | null = null;
    if (kerbGeo) {
      const kerbMat = this.createKerbMaterial();
      kerbMesh = new THREE.Mesh(kerbGeo, kerbMat);
      kerbMesh.receiveShadow = true;
      kerbMesh.castShadow = true;
    }

    // Build Gravel Trap Geometry
    const gravelGeo = this.buildGravelGeometry(samples, isClosed);
    let gravelMesh: THREE.Mesh | null = null;
    if (gravelGeo) {
      const gravelMat = this.createGravelMaterial();
      gravelMesh = new THREE.Mesh(gravelGeo, gravelMat);
      gravelMesh.receiveShadow = true;
      gravelMesh.castShadow = true;
    }

    // Build Road Substructure Geometry (3D thickness for realistic elevated tracks)
    const subGeo = this.buildSubstructureGeometry(samples, isClosed, 0.45);
    const subMat = this.createSubstructureMaterial();
    const substructureMesh = new THREE.Mesh(subGeo, subMat);
    substructureMesh.receiveShadow = true;
    substructureMesh.castShadow = true;

    // Centerline Preview Line
    const lineGeo = new THREE.BufferGeometry().setFromPoints(samples.map(s => s.position.clone().addScaledVector(s.normal, 0.05)));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00f2fe,
      linewidth: 2,
      depthTest: true
    });
    const centerlineLine = new THREE.Line(lineGeo, lineMat);

    // Build 2D/3D Surface Mask Spatial Grid
    const surfaceMap = new SurfaceMap(samples, isClosed);

    return {
      roadMesh,
      kerbMesh,
      gravelMesh,
      substructureMesh,
      centerlineLine,
      samples,
      surfaceMap,
      totalLengthMeters: totalLength,
      maxElevation,
      minElevation,
      maxBankingDeg
    };
  }

  private static interpolatePointAttributes(
    points: TrackControlPoint[],
    u: number,
    isClosed: boolean
  ): {
    bankingDeg: number;
    width: number;
    kerbLeftWidth: number;
    kerbRightWidth: number;
    gravelLeftWidth: number;
    gravelRightWidth: number;
  } {
    if (points.length === 0) {
      return { bankingDeg: 0, width: 12, kerbLeftWidth: 0, kerbRightWidth: 0, gravelLeftWidth: 0, gravelRightWidth: 0 };
    }
    if (points.length === 1) {
      const p = points[0];
      return {
        bankingDeg: p.bankingDeg,
        width: p.width,
        kerbLeftWidth: p.kerbLeft ? 1.2 : 0,
        kerbRightWidth: p.kerbRight ? 1.2 : 0,
        gravelLeftWidth: p.gravelLeftWidth || 0,
        gravelRightWidth: p.gravelRightWidth || 0
      };
    }

    const n = isClosed ? points.length : points.length - 1;
    const scaledU = u * n;
    const index = Math.floor(scaledU);
    const frac = scaledU - index;

    const i0 = index % points.length;
    const i1 = (index + 1) % points.length;

    const p0 = points[i0];
    const p1 = points[i1];

    const smoothT = (1 - Math.cos(frac * Math.PI)) / 2;

    const bankingDeg = THREE.MathUtils.lerp(p0.bankingDeg, p1.bankingDeg, smoothT);
    const width = THREE.MathUtils.lerp(p0.width, p1.width, smoothT);

    const kL0 = p0.kerbLeft ? 1.2 : 0;
    const kL1 = p1.kerbLeft ? 1.2 : 0;
    const kerbLeftWidth = THREE.MathUtils.lerp(kL0, kL1, smoothT);

    const kR0 = p0.kerbRight ? 1.2 : 0;
    const kR1 = p1.kerbRight ? 1.2 : 0;
    const kerbRightWidth = THREE.MathUtils.lerp(kR0, kR1, smoothT);

    const gL0 = p0.gravelLeftWidth || 0;
    const gL1 = p1.gravelLeftWidth || 0;
    const gravelLeftWidth = THREE.MathUtils.lerp(gL0, gL1, smoothT);

    const gR0 = p0.gravelRightWidth || 0;
    const gR1 = p1.gravelRightWidth || 0;
    const gravelRightWidth = THREE.MathUtils.lerp(gR0, gR1, smoothT);

    return {
      bankingDeg,
      width,
      kerbLeftWidth,
      kerbRightWidth,
      gravelLeftWidth,
      gravelRightWidth
    };
  }

  private static buildRoadGeometry(samples: TrackSplineSample[], isClosed: boolean): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const numSlices = samples.length;
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const uvScaleV = 0.2;

    for (let i = 0; i < numSlices; i++) {
      const s = samples[i];
      vertices.push(s.leftPoint.x, s.leftPoint.y, s.leftPoint.z);
      vertices.push(s.position.x, s.position.y, s.position.z);
      vertices.push(s.rightPoint.x, s.rightPoint.y, s.rightPoint.z);

      normals.push(s.normal.x, s.normal.y, s.normal.z);
      normals.push(s.normal.x, s.normal.y, s.normal.z);
      normals.push(s.normal.x, s.normal.y, s.normal.z);

      const v = s.distance * uvScaleV;
      uvs.push(0.0, v, 0.5, v, 1.0, v);
    }

    const segments = numSlices - 1;
    for (let i = 0; i < segments; i++) {
      const rowA = i * 3;
      const rowB = (isClosed && i === segments - 1 ? 0 : i + 1) * 3;

      indices.push(rowA + 0, rowB + 0, rowA + 1);
      indices.push(rowA + 1, rowB + 0, rowB + 1);

      indices.push(rowA + 1, rowB + 1, rowA + 2);
      indices.push(rowA + 2, rowB + 1, rowB + 2);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  private static buildKerbGeometry(samples: TrackSplineSample[], isClosed: boolean): THREE.BufferGeometry | null {
    const numSlices = samples.length;
    let hasKerbs = false;
    for (const s of samples) {
      if (s.kerbLeftWidth > 0.05 || s.kerbRightWidth > 0.05) {
        hasKerbs = true;
        break;
      }
    }
    if (!hasKerbs) return null;

    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const uvScaleV = 0.5; // Striped frequency

    for (let i = 0; i < numSlices; i++) {
      const s = samples[i];
      const leftInner = s.leftPoint;
      const leftOuter = s.leftKerbOuterPoint || s.leftPoint;
      const rightInner = s.rightPoint;
      const rightOuter = s.rightKerbOuterPoint || s.rightPoint;

      vertices.push(leftOuter.x, leftOuter.y, leftOuter.z);
      vertices.push(leftInner.x, leftInner.y, leftInner.z);
      vertices.push(rightInner.x, rightInner.y, rightInner.z);
      vertices.push(rightOuter.x, rightOuter.y, rightOuter.z);

      normals.push(s.normal.x, s.normal.y, s.normal.z);
      normals.push(s.normal.x, s.normal.y, s.normal.z);
      normals.push(s.normal.x, s.normal.y, s.normal.z);
      normals.push(s.normal.x, s.normal.y, s.normal.z);

      const v = s.distance * uvScaleV;
      uvs.push(0, v, 1, v, 0, v, 1, v);
    }

    const segments = numSlices - 1;
    for (let i = 0; i < segments; i++) {
      const s0 = samples[i];
      const s1 = samples[(isClosed && i === segments - 1 ? 0 : i + 1)];
      const rowA = i * 4;
      const rowB = (isClosed && i === segments - 1 ? 0 : i + 1) * 4;

      // Left Kerb Quad (indices 0, 1)
      if (s0.kerbLeftWidth > 0.05 || s1.kerbLeftWidth > 0.05) {
        indices.push(rowA + 0, rowB + 0, rowA + 1);
        indices.push(rowA + 1, rowB + 0, rowB + 1);
      }

      // Right Kerb Quad (indices 2, 3)
      if (s0.kerbRightWidth > 0.05 || s1.kerbRightWidth > 0.05) {
        indices.push(rowA + 2, rowB + 2, rowA + 3);
        indices.push(rowA + 3, rowB + 2, rowB + 3);
      }
    }

    if (indices.length === 0) return null;

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  private static buildGravelGeometry(samples: TrackSplineSample[], isClosed: boolean): THREE.BufferGeometry | null {
    const numSlices = samples.length;
    let hasGravel = false;
    for (const s of samples) {
      if (s.gravelLeftWidth > 0.1 || s.gravelRightWidth > 0.1) {
        hasGravel = true;
        break;
      }
    }
    if (!hasGravel) return null;

    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const uvScaleV = 0.25;

    for (let i = 0; i < numSlices; i++) {
      const s = samples[i];
      const leftInner = s.leftKerbOuterPoint || s.leftPoint;
      const leftOuter = s.leftGravelOuterPoint || leftInner;
      const rightInner = s.rightKerbOuterPoint || s.rightPoint;
      const rightOuter = s.rightGravelOuterPoint || rightInner;

      vertices.push(leftOuter.x, leftOuter.y, leftOuter.z);
      vertices.push(leftInner.x, leftInner.y, leftInner.z);
      vertices.push(rightInner.x, rightInner.y, rightInner.z);
      vertices.push(rightOuter.x, rightOuter.y, rightOuter.z);

      const up = new THREE.Vector3(0, 1, 0);
      normals.push(up.x, up.y, up.z, up.x, up.y, up.z, up.x, up.y, up.z, up.x, up.y, up.z);

      const v = s.distance * uvScaleV;
      uvs.push(0, v, 1, v, 0, v, 1, v);
    }

    const segments = numSlices - 1;
    for (let i = 0; i < segments; i++) {
      const s0 = samples[i];
      const s1 = samples[(isClosed && i === segments - 1 ? 0 : i + 1)];
      const rowA = i * 4;
      const rowB = (isClosed && i === segments - 1 ? 0 : i + 1) * 4;

      // Left Gravel Quad (indices 0, 1)
      if (s0.gravelLeftWidth > 0.1 || s1.gravelLeftWidth > 0.1) {
        indices.push(rowA + 0, rowB + 0, rowA + 1);
        indices.push(rowA + 1, rowB + 0, rowB + 1);
      }

      // Right Gravel Quad (indices 2, 3)
      if (s0.gravelRightWidth > 0.1 || s1.gravelRightWidth > 0.1) {
        indices.push(rowA + 2, rowB + 2, rowA + 3);
        indices.push(rowA + 3, rowB + 2, rowB + 3);
      }
    }

    if (indices.length === 0) return null;

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  private static buildSubstructureGeometry(
    samples: TrackSplineSample[],
    isClosed: boolean,
    thickness: number = 0.45
  ): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const numSlices = samples.length;
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const uvScaleV = 0.2;

    for (let i = 0; i < numSlices; i++) {
      const s = samples[i];
      const bottomOffset = s.normal.clone().multiplyScalar(-thickness);

      const topLeft = s.leftPoint.clone();
      const bottomLeft = s.leftPoint.clone().add(bottomOffset);
      const topRight = s.rightPoint.clone();
      const bottomRight = s.rightPoint.clone().add(bottomOffset);

      vertices.push(topLeft.x, topLeft.y, topLeft.z);
      vertices.push(bottomLeft.x, bottomLeft.y, bottomLeft.z);
      vertices.push(topRight.x, topRight.y, topRight.z);
      vertices.push(bottomRight.x, bottomRight.y, bottomRight.z);

      const leftNorm = s.binormal.clone().negate();
      normals.push(leftNorm.x, leftNorm.y, leftNorm.z);
      normals.push(leftNorm.x, leftNorm.y, leftNorm.z);

      const rightNorm = s.binormal.clone();
      normals.push(rightNorm.x, rightNorm.y, rightNorm.z);
      normals.push(rightNorm.x, rightNorm.y, rightNorm.z);

      const v = s.distance * uvScaleV;
      uvs.push(0, v, 0, v, 1, v, 1, v);
    }

    const segments = numSlices - 1;
    for (let i = 0; i < segments; i++) {
      const rowA = i * 4;
      const rowB = (isClosed && i === segments - 1 ? 0 : i + 1) * 4;

      indices.push(rowA + 0, rowA + 1, rowB + 0);
      indices.push(rowB + 0, rowA + 1, rowB + 1);

      indices.push(rowA + 2, rowB + 2, rowA + 3);
      indices.push(rowB + 2, rowB + 3, rowA + 3);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  private static createRoadMaterial(): THREE.Material {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(0, 0, 512, 512);

    for (let x = 0; x < 512; x += 4) {
      for (let y = 0; y < 512; y += 4) {
        const val = 25 + Math.floor(Math.random() * 14);
        ctx.fillStyle = `rgb(${val}, ${val + 2}, ${val + 4})`;
        ctx.fillRect(x, y, 4, 4);
      }
    }

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(10, 0, 14, 512);
    ctx.fillRect(512 - 24, 0, 14, 512);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    const dashLength = 64;
    for (let y = 0; y < 512; y += dashLength * 2) {
      ctx.fillRect(256 - 4, y, 8, dashLength);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.82,
      metalness: 0.12
    });
  }

  private static createKerbMaterial(): THREE.Material {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // F1 Style Red and White alternating blocks
    ctx.fillStyle = '#ef233c'; // Red
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#f8fafc'; // White
    ctx.fillRect(0, 128, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.7,
      metalness: 0.2
    });
  }

  private static createGravelMaterial(): THREE.Material {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#9c845b';
    ctx.fillRect(0, 0, 256, 256);

    for (let x = 0; x < 256; x += 4) {
      for (let y = 0; y < 256; y += 4) {
        const val = 120 + Math.floor(Math.random() * 45);
        ctx.fillStyle = `rgb(${val + 20}, ${val}, ${val - 30})`;
        ctx.fillRect(x, y, 4, 4);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.95,
      metalness: 0.05
    });
  }

  private static createSubstructureMaterial(): THREE.Material {
    return new THREE.MeshStandardMaterial({
      color: 0x161b24,
      roughness: 0.9,
      metalness: 0.25
    });
  }
}
