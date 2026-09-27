import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { type QualitySettings } from '../core/types';

export class AppScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public controls: OrbitControls;

  public dirLight: THREE.DirectionalLight;
  public ambientLight: THREE.AmbientLight;
  public hemiLight: THREE.HemisphereLight;
  private groundMesh: THREE.Mesh;
  private gridHelper: THREE.GridHelper;
  public testCube: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.FogExp2(0x0a0c10, 0.001);

    // 3D Orbit Camera
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, quality.maxVisibleDrawDistance);
    this.camera.position.set(0, 75, 110);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below ground
    this.controls.minDistance = 2;
    this.controls.maxDistance = 600;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xddeeff, 0x111822, 0.55);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff8ee, 2.0);
    this.dirLight.position.set(80, 140, 80);
    this.dirLight.castShadow = quality.shadowsEnabled;
    this.dirLight.shadow.mapSize.width = quality.shadowMapResolution;
    this.dirLight.shadow.mapSize.height = quality.shadowMapResolution;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 400;
    this.dirLight.shadow.camera.left = -160;
    this.dirLight.shadow.camera.right = 160;
    this.dirLight.shadow.camera.top = 160;
    this.dirLight.shadow.camera.bottom = -160;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    // Ground Plane
    const groundGeo = new THREE.PlaneGeometry(2000, 2000, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0e1118,
      roughness: 0.9,
      metalness: 0.1
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // Large engineering grid for circuit reference
    this.gridHelper = new THREE.GridHelper(400, 80, 0x00f2fe, 0x1c2436);
    this.gridHelper.position.y = 0.002;
    this.scene.add(this.gridHelper);

    // Small paddock marker cube (at origin)
    const cubeGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0xef233c,
      roughness: 0.3,
      metalness: 0.8
    });
    this.testCube = new THREE.Mesh(cubeGeo, cubeMat);
    this.testCube.position.set(0, 0.6, 0);
    this.testCube.castShadow = true;
    this.testCube.receiveShadow = true;
    this.testCube.visible = false; // Hidden when full track is active
    this.scene.add(this.testCube);
  }

  public update(deltaSeconds: number, isOrbitActive: boolean): void {
    if (isOrbitActive) {
      this.controls.update();
    }

    if (this.testCube && this.testCube.visible) {
      this.testCube.rotation.y += deltaSeconds * 1.2;
    }
  }

  public applyQuality(quality: QualitySettings): void {
    this.camera.far = quality.maxVisibleDrawDistance;
    this.camera.updateProjectionMatrix();

    if (this.scene.fog instanceof THREE.FogExp2) {
      const density = 1.0 / quality.maxVisibleDrawDistance;
      this.scene.fog.density = density * 1.2;
    }

    this.dirLight.castShadow = quality.shadowsEnabled;
    this.dirLight.shadow.mapSize.width = quality.shadowMapResolution;
    this.dirLight.shadow.mapSize.height = quality.shadowMapResolution;
    if (this.dirLight.shadow.map) {
      this.dirLight.shadow.map.dispose();
      this.dirLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  public handleResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
