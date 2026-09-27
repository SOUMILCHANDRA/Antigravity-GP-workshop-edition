import { NodeIO, Document, Node, mat4 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  prune,
  dedup,
  weld,
  join,
  simplify,
  resample,
  cloneDocument
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import * as fs from 'fs';
import * as path from 'path';

interface CarSpec {
  id: string;
  name: string;
  year: number;
  rawFile: string;
  outputPrefix: string;
  realDimensions: {
    lengthMeters: number;
    widthMeters: number;
    heightMeters: number;
    wheelbaseMeters: number;
  };
  targetScale: number;
  lodTargets: {
    mediumRatio: number;
    lowRatio: number;
  };
}

const CAR_SPECS: CarSpec[] = [
  {
    id: 'ferrari_312',
    name: 'Ferrari 312 F1-67',
    year: 1967,
    rawFile: 'public/models/raw/1967_ferrari_312.glb',
    outputPrefix: 'ferrari_312',
    realDimensions: {
      lengthMeters: 3.83,
      widthMeters: 1.52,
      heightMeters: 0.87,
      wheelbaseMeters: 2.40
    },
    targetScale: 1.0,
    lodTargets: {
      mediumRatio: 0.50, // ~39K tris
      lowRatio: 0.22      // ~17K tris
    }
  },
  {
    id: 'lotus_72d',
    name: 'Lotus 72D',
    year: 1972,
    rawFile: 'public/models/raw/1972_lotus_72d.glb',
    outputPrefix: 'lotus_72d',
    realDimensions: {
      lengthMeters: 4.19,
      widthMeters: 2.10,
      heightMeters: 1.17,
      wheelbaseMeters: 2.54
    },
    targetScale: 0.225,
    lodTargets: {
      mediumRatio: 0.65, // ~21K tris
      lowRatio: 0.35      // ~11K tris
    }
  },
  {
    id: 'mclaren_mp45',
    name: 'McLaren MP4/5',
    year: 1989,
    rawFile: 'public/models/raw/mclaren_mp45__formula_1.glb',
    outputPrefix: 'mclaren_mp45',
    realDimensions: {
      lengthMeters: 4.40,
      widthMeters: 2.15,
      heightMeters: 1.00,
      wheelbaseMeters: 2.90
    },
    targetScale: 0.603,
    lodTargets: {
      mediumRatio: 0.14, // ~45K tris (from 328K)
      lowRatio: 0.05      // ~16K tris (from 328K)
    }
  }
];

interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
}

function calculateWorldBoundingBox(doc: Document): BoundingBox {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const root = doc.getRoot();
  const scenes = root.listScenes();
  const scene = scenes[0] || root.getDefaultScene();

  if (!scene) {
    return { min: [0,0,0], max: [0,0,0], size: [0,0,0], center: [0,0,0] };
  }

  function traverseNode(node: Node, parentMatrix: mat4) {
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const posAttr = prim.getAttribute('POSITION');
        if (posAttr) {
          const count = posAttr.getCount();
          for (let i = 0; i < count; i++) {
            const p = posAttr.getElement(i, [0, 0, 0]) as [number, number, number];
            const translation = node.getTranslation();
            const scale = node.getScale();
            const wx = (p[0] * scale[0]) + translation[0];
            const wy = (p[1] * scale[1]) + translation[1];
            const wz = (p[2] * scale[2]) + translation[2];

            minX = Math.min(minX, wx);
            minY = Math.min(minY, wy);
            minZ = Math.min(minZ, wz);
            maxX = Math.max(maxX, wx);
            maxY = Math.max(maxY, wy);
            maxZ = Math.max(maxZ, wz);
          }
        }
      }
    }

    for (const child of node.listChildren()) {
      traverseNode(child, parentMatrix);
    }
  }

  const identity: mat4 = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];

  for (const child of scene.listChildren()) {
    traverseNode(child, identity);
  }

  if (minX === Infinity) {
    return { min: [-1,-1,-1], max: [1,1,1], size: [2,2,2], center: [0,0,0] };
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
  };
}

function countTriangles(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (idx) {
        tris += idx.getCount() / 3;
      } else if (pos) {
        tris += pos.getCount() / 3;
      }
    }
  }
  return Math.round(tris);
}

async function processCar(spec: CarSpec, io: NodeIO, outDir: string) {
  console.log(`\n======================================================`);
  console.log(`Processing Model: ${spec.name} (${spec.year})`);
  console.log(`Raw File: ${spec.rawFile}`);
  console.log(`======================================================`);

  const doc = await io.read(spec.rawFile);
  const rawTris = countTriangles(doc);
  const rawBounds = calculateWorldBoundingBox(doc);

  console.log(`[Raw Model Metrics]`);
  console.log(`- Triangles: ${rawTris.toLocaleString()}`);
  console.log(`- Raw Bounds (X, Y, Z): ${rawBounds.size[0].toFixed(2)}m x ${rawBounds.size[1].toFixed(2)}m x ${rawBounds.size[2].toFixed(2)}m`);

  // 1. Optimize & Merge draw calls
  await doc.transform(
    weld({ tolerance: 0.0001 }),
    dedup(),
    resample(),
    prune()
  );

  // For Ferrari, join compatible primitives to reduce draw calls into single digits
  if (spec.id === 'ferrari_312') {
    await doc.transform(join());
    console.log(`- Ferrari draw calls reduced via mesh joining! Meshes: ${doc.getRoot().listMeshes().length}`);
  }

  // 2. Apply Scale and Recenter Pivot at Bottom-Center (Ground contact Y=0)
  const meshes = doc.getRoot().listMeshes();
  const scale = spec.targetScale;

  let lowestY = Infinity;
  let centerX = 0;
  let centerZ = 0;
  let totalVerts = 0;

  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute('POSITION');
      if (posAttr) {
        const count = posAttr.getCount();
        for (let i = 0; i < count; i++) {
          const p = posAttr.getElement(i, [0, 0, 0]) as [number, number, number];
          lowestY = Math.min(lowestY, p[1] * scale);
          centerX += p[0] * scale;
          centerZ += p[2] * scale;
          totalVerts++;
        }
      }
    }
  }

  centerX = totalVerts > 0 ? centerX / totalVerts : 0;
  centerZ = totalVerts > 0 ? centerZ / totalVerts : 0;

  // Bake scale and ground-contact translation directly into vertex positions
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute('POSITION');
      if (posAttr) {
        const count = posAttr.getCount();
        for (let i = 0; i < count; i++) {
          const p = posAttr.getElement(i, [0, 0, 0]) as [number, number, number];
          const newX = (p[0] * scale) - centerX;
          const newY = (p[1] * scale) - lowestY; // Bottom sits on ground Y=0
          const newZ = (p[2] * scale) - centerZ;
          posAttr.setElement(i, [newX, newY, newZ]);
        }
      }
    }
  }

  const scaledBounds = calculateWorldBoundingBox(doc);
  console.log(`\n[Scaled & Centered Bounds]`);
  console.log(`- Real Spec Length: ${spec.realDimensions.lengthMeters}m | Modeled: ${Math.max(scaledBounds.size[0], scaledBounds.size[1], scaledBounds.size[2]).toFixed(2)}m`);
  console.log(`- Real Spec Width:  ${spec.realDimensions.widthMeters}m`);
  console.log(`- Real Spec Height: ${spec.realDimensions.heightMeters}m`);

  // 3. Export High LOD
  const highFile = path.join(outDir, `${spec.outputPrefix}_high.glb`);
  await io.write(highFile, doc);
  const highSize = (fs.statSync(highFile).size / (1024 * 1024)).toFixed(2);
  const highTris = countTriangles(doc);
  console.log(`\n[High LOD Tier] -> ${highFile} (${highSize} MB, ${highTris.toLocaleString()} tris)`);

  // 4. Generate Medium LOD Tier
  await MeshoptSimplifier.ready;
  const mediumDoc = cloneDocument(doc);
  await mediumDoc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: spec.lodTargets.mediumRatio,
      error: 0.005
    }),
    weld({ tolerance: 0.0001 }),
    prune()
  );
  const medFile = path.join(outDir, `${spec.outputPrefix}_medium.glb`);
  await io.write(medFile, mediumDoc);
  const medSize = (fs.statSync(medFile).size / (1024 * 1024)).toFixed(2);
  const medTris = countTriangles(mediumDoc);
  console.log(`[Medium LOD Tier] -> ${medFile} (${medSize} MB, ${medTris.toLocaleString()} tris)`);

  // 5. Generate Low LOD Tier (Potato Mode)
  const lowDoc = cloneDocument(doc);
  await lowDoc.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: spec.lodTargets.lowRatio,
      error: 0.015
    }),
    weld({ tolerance: 0.0005 }),
    prune()
  );
  const lowFile = path.join(outDir, `${spec.outputPrefix}_low.glb`);
  await io.write(lowFile, lowDoc);
  const lowSize = (fs.statSync(lowFile).size / (1024 * 1024)).toFixed(2);
  const lowTris = countTriangles(lowDoc);
  console.log(`[Low LOD Tier] -> ${lowFile} (${lowSize} MB, ${lowTris.toLocaleString()} tris)`);
}

async function main() {
  const outDir = path.resolve('public/models/normalized');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  for (const spec of CAR_SPECS) {
    await processCar(spec, io, outDir);
  }

  console.log('\n======================================================');
  console.log('✅ ALL 3 VEHICLE MODELS NORMALIZED AND LODs GENERATED!');
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('Fatal model pipeline error:', err);
  process.exit(1);
});
