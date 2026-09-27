import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as path from 'path';

async function inspect() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const models = [
    { name: 'Ferrari 312 (1967)', file: 'public/models/raw/1967_ferrari_312.glb' },
    { name: 'Lotus 72D (1972)', file: 'public/models/raw/1972_lotus_72d.glb' },
    { name: 'McLaren MP4/5 (1989)', file: 'public/models/raw/mclaren_mp45__formula_1.glb' }
  ];

  console.log('=== RAW MODEL INSPECTION ===\n');

  for (const m of models) {
    const doc = await io.read(m.file);
    const root = doc.getRoot();
    const meshes = root.listMeshes();
    const materials = root.listMaterials();
    const textures = root.listTextures();
    const nodes = root.listNodes();

    let totalTris = 0;
    for (const mesh of meshes) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const pos = prim.getAttribute('POSITION');
        if (indices) {
          totalTris += indices.getCount() / 3;
        } else if (pos) {
          totalTris += pos.getCount() / 3;
        }
      }
    }

    console.log(`[${m.name}]`);
    console.log(`- Meshes: ${meshes.length}`);
    console.log(`- Materials: ${materials.length}`);
    console.log(`- Textures: ${textures.length}`);
    console.log(`- Nodes: ${nodes.length}`);
    console.log(`- Triangles: ${Math.round(totalTris).toLocaleString()}`);
    console.log('');
  }
}

inspect().catch(console.error);
