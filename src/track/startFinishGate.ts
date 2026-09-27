import * as THREE from 'three';
import type { TrackSplineSample } from './types';
import type { StartFinishGateData } from './serializationSchema';

export class StartFinishGate {
  public group: THREE.Group;
  private gantryMesh: THREE.Group;
  private lineMesh: THREE.Mesh;
  private lightMeshes: THREE.Mesh[] = [];

  private sampleIndex: number = 0;
  private currentData: StartFinishGateData;

  constructor() {
    this.group = new THREE.Group();
    this.gantryMesh = new THREE.Group();
    this.group.add(this.gantryMesh);

    // 1. Checkered Line on Track Surface
    const lineCanvas = document.createElement('canvas');
    lineCanvas.width = 256;
    lineCanvas.height = 64;
    const ctx = lineCanvas.getContext('2d')!;

    // Checkered pattern (2 rows of 8 squares)
    const squareSize = 32;
    for (let x = 0; x < 256; x += squareSize) {
      for (let y = 0; y < 64; y += squareSize) {
        const isWhite = ((x / squareSize) + (y / squareSize)) % 2 === 0;
        ctx.fillStyle = isWhite ? '#ffffff' : '#111111';
        ctx.fillRect(x, y, squareSize, squareSize);
      }
    }
    // Red edge strips
    ctx.fillStyle = '#ef233c';
    ctx.fillRect(0, 0, 256, 4);
    ctx.fillRect(0, 60, 256, 4);

    const lineTexture = new THREE.CanvasTexture(lineCanvas);
    const lineGeo = new THREE.PlaneGeometry(13, 2);
    const lineMat = new THREE.MeshStandardMaterial({
      map: lineTexture,
      roughness: 0.5,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });

    this.lineMesh = new THREE.Mesh(lineGeo, lineMat);
    this.lineMesh.rotation.x = -Math.PI / 2;
    this.lineMesh.position.y = 0.02;
    this.group.add(this.lineMesh);

    // 2. Overhead Truss Gantry
    this.buildGantry(14, 7.5);

    this.currentData = {
      sampleIndex: 0,
      distanceAlongSpline: 0,
      position: { x: 0, y: 0, z: 0 },
      forwardVector: { x: 1, y: 0, z: 0 },
      width: 13
    };
  }

  private buildGantry(spanWidth: number, height: number): void {
    while (this.gantryMesh.children.length > 0) {
      this.gantryMesh.remove(this.gantryMesh.children[0]);
    }

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x2b303c,
      metalness: 0.9,
      roughness: 0.3
    });

    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x15181e,
      metalness: 0.5,
      roughness: 0.4
    });

    // Left & Right Support Pillars
    const halfSpan = spanWidth / 2 + 0.8;
    const pillarGeo = new THREE.BoxGeometry(0.6, height, 0.6);

    const leftPillar = new THREE.Mesh(pillarGeo, metalMat);
    leftPillar.position.set(-halfSpan, height / 2, 0);
    leftPillar.castShadow = true;
    this.gantryMesh.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, metalMat);
    rightPillar.position.set(halfSpan, height / 2, 0);
    rightPillar.castShadow = true;
    this.gantryMesh.add(rightPillar);

    // Cross Truss Beam
    const beamGeo = new THREE.BoxGeometry(spanWidth + 2.2, 0.9, 1.2);
    const beam = new THREE.Mesh(beamGeo, metalMat);
    beam.position.set(0, height, 0);
    beam.castShadow = true;
    this.gantryMesh.add(beam);

    // Sponsor / Timing Display Board
    const boardGeo = new THREE.BoxGeometry(spanWidth * 0.7, 1.1, 0.2);
    const board = new THREE.Mesh(boardGeo, carbonMat);
    board.position.set(0, height - 0.7, 0);
    this.gantryMesh.add(board);

    // 5 F1 Starting Light Pods
    this.lightMeshes = [];
    const lightSpacing = (spanWidth * 0.5) / 4;
    const startX = -(spanWidth * 0.25);

    for (let i = 0; i < 5; i++) {
      const lightPodGeo = new THREE.BoxGeometry(0.5, 0.9, 0.3);
      const lightPod = new THREE.Mesh(lightPodGeo, carbonMat);
      lightPod.position.set(startX + i * lightSpacing, height - 0.7, 0.15);

      const bulbGeo = new THREE.CircleGeometry(0.18, 16);
      const bulbMat = new THREE.MeshBasicMaterial({
        color: 0xef233c
      });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(0, 0, 0.16);
      lightPod.add(bulb);

      this.lightMeshes.push(bulb);
      this.gantryMesh.add(lightPod);
    }
  }

  public updatePositionFromSpline(samples: TrackSplineSample[], sampleIdx: number): StartFinishGateData {
    if (samples.length === 0) return this.currentData;

    const idx = Math.max(0, Math.min(samples.length - 1, sampleIdx));
    this.sampleIndex = idx;
    const s = samples[idx];

    // Position group at centerline sample
    this.group.position.copy(s.position);

    // Align rotation with track tangent & normal
    const tangent = s.tangent.clone().normalize();
    const normal = s.normal.clone().normalize();
    const binormal = s.binormal.clone().normalize();

    // Rotation Matrix
    const rotMatrix = new THREE.Matrix4().makeBasis(binormal, normal, tangent.clone().negate());
    this.group.rotation.setFromRotationMatrix(rotMatrix);

    // Adjust width
    const trackWidth = s.width;
    this.lineMesh.scale.set(trackWidth / 13, 1, 1);
    this.buildGantry(trackWidth + 1.5, 7.5);

    this.currentData = {
      sampleIndex: idx,
      distanceAlongSpline: s.distance,
      position: { x: s.position.x, y: s.position.y, z: s.position.z },
      forwardVector: { x: tangent.x, y: tangent.y, z: tangent.z },
      width: trackWidth
    };

    return this.currentData;
  }

  public getData(): StartFinishGateData {
    return this.currentData;
  }

  public setSampleIndex(idx: number): void {
    this.sampleIndex = idx;
  }

  public getSampleIndex(): number {
    return this.sampleIndex;
  }

  public setLightsActive(activeCount: number): void {
    this.lightMeshes.forEach((bulb, idx) => {
      const mat = bulb.material as THREE.MeshBasicMaterial;
      if (idx < activeCount) {
        mat.color.setHex(0xef233c); // Bright Red
      } else {
        mat.color.setHex(0x330005); // Dim / Off
      }
    });
  }
}
