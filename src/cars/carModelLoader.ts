import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type CarSpecs, CAR_ROSTER } from './carData';
import { QualityTier } from '../core/types';

export interface LoadedCarAsset {
  specs: CarSpecs;
  tier: QualityTier;
  scene: THREE.Group;
  triangleCount: number;
  meshCount: number;
  boundingBox: {
    length: number;
    width: number;
    height: number;
  };
}

export class CarModelLoader {
  private loader: GLTFLoader;
  private cache: Map<string, THREE.Group> = new Map();
  private loadingPromises: Map<string, Promise<THREE.Group>> = new Map();

  constructor() {
    this.loader = new GLTFLoader();
  }

  private getCacheKey(carId: string, tier: QualityTier): string {
    return `${carId}_${tier}`;
  }

  public async loadCarModel(carId: string, tier: QualityTier): Promise<LoadedCarAsset> {
    const specs = CAR_ROSTER[carId];
    if (!specs) {
      throw new Error(`Car "${carId}" not found in CAR_ROSTER.`);
    }

    const modelPath = specs.models[tier] || specs.models[QualityTier.High];
    const cacheKey = this.getCacheKey(carId, tier);

    let rawGroup: THREE.Group;

    if (this.cache.has(cacheKey)) {
      rawGroup = this.cache.get(cacheKey)!;
    } else if (this.loadingPromises.has(cacheKey)) {
      rawGroup = await this.loadingPromises.get(cacheKey)!;
    } else {
      const loadPromise = new Promise<THREE.Group>((resolve, reject) => {
        this.loader.load(
          modelPath,
          (gltf) => {
            const root = gltf.scene;

            // Configure shadow casting and materials
            root.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
              }
            });

            this.cache.set(cacheKey, root);
            resolve(root);
          },
          undefined,
          (error) => {
            console.error(`Failed to load car model ${modelPath}:`, error);
            reject(error);
          }
        );
      });

      this.loadingPromises.set(cacheKey, loadPromise);
      rawGroup = await loadPromise;
    }

    // Clone the model so multiple instances (player + AI) have independent transforms
    const clonedScene = rawGroup.clone(true);

    // Compute bounding box and triangle stats
    let totalTris = 0;
    let meshCount = 0;
    const box = new THREE.Box3().setFromObject(clonedScene);
    const size = new THREE.Vector3();
    box.getSize(size);

    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshCount++;
        const geom = (child as THREE.Mesh).geometry;
        if (geom.index) {
          totalTris += geom.index.count / 3;
        } else if (geom.attributes.position) {
          totalTris += geom.attributes.position.count / 3;
        }
      }
    });

    return {
      specs,
      tier,
      scene: clonedScene,
      triangleCount: Math.round(totalTris),
      meshCount,
      boundingBox: {
        length: Math.max(size.x, size.z),
        width: Math.min(size.x, size.z),
        height: size.y
      }
    };
  }

  public preloadAllRoster(tier: QualityTier): void {
    Object.keys(CAR_ROSTER).forEach(carId => {
      this.loadCarModel(carId, tier).catch(() => {});
    });
  }
}

export const carModelLoader = new CarModelLoader();
