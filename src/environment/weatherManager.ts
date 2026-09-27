import * as THREE from 'three';
import { type AppScene } from '../graphics/scene';

export type WeatherPreset = 'clear_noon' | 'sunset' | 'night' | 'overcast_rain';
export type TireCompound = 'soft_slick' | 'hard_slick' | 'intermediate' | 'full_wet';

export interface WeatherState {
  preset: WeatherPreset;
  rainIntensity: number; // 0..1
  trackWetness: number; // 0..1
  sunElevationDeg: number;
}

export class WeatherManager {
  private appScene: AppScene;
  private currentPreset: WeatherPreset = 'clear_noon';
  private trackWetness: number = 0;
  private rainParticles: THREE.Points | null = null;
  private rainGeometry: THREE.BufferGeometry | null = null;
  private rainCount: number = 2500;

  constructor(appScene: AppScene) {
    this.appScene = appScene;
    this.createRainSystem();
    this.applyPreset('clear_noon');
  }

  private createRainSystem(): void {
    this.rainGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.rainCount * 3);
    const velocities = new Float32Array(this.rainCount);

    for (let i = 0; i < this.rainCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
      velocities[i] = 25 + Math.random() * 15;
    }

    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainGeometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));

    const rainMat = new THREE.PointsMaterial({
      color: 0x90cdf4,
      size: 0.18,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });

    this.rainParticles = new THREE.Points(this.rainGeometry, rainMat);
    this.rainParticles.visible = false;
    this.appScene.scene.add(this.rainParticles);
  }

  public applyPreset(preset: WeatherPreset): void {
    this.currentPreset = preset;
    const sunLight = this.appScene.dirLight;
    const ambientLight = this.appScene.ambientLight;

    switch (preset) {
      case 'clear_noon':
        this.trackWetness = 0;
        sunLight.color.setHex(0xfffaed);
        sunLight.intensity = 2.4;
        sunLight.position.set(120, 180, 80);
        ambientLight.color.setHex(0x2a3b5c);
        ambientLight.intensity = 0.9;
        this.appScene.scene.background = new THREE.Color(0x0a101d);
        if (this.rainParticles) this.rainParticles.visible = false;
        break;

      case 'sunset':
        this.trackWetness = 0;
        sunLight.color.setHex(0xff7733);
        sunLight.intensity = 3.2;
        sunLight.position.set(220, 35, 60);
        ambientLight.color.setHex(0x4a2030);
        ambientLight.intensity = 0.7;
        this.appScene.scene.background = new THREE.Color(0x1a0a14);
        if (this.rainParticles) this.rainParticles.visible = false;
        break;

      case 'night':
        this.trackWetness = 0;
        sunLight.color.setHex(0x6080b0);
        sunLight.intensity = 0.4;
        sunLight.position.set(40, 120, 40);
        ambientLight.color.setHex(0x060c18);
        ambientLight.intensity = 0.3;
        this.appScene.scene.background = new THREE.Color(0x020408);
        if (this.rainParticles) this.rainParticles.visible = false;
        break;

      case 'overcast_rain':
        this.trackWetness = 0.85;
        sunLight.color.setHex(0xa0b0c0);
        sunLight.intensity = 1.1;
        sunLight.position.set(60, 140, 40);
        ambientLight.color.setHex(0x1a2430);
        ambientLight.intensity = 0.8;
        this.appScene.scene.background = new THREE.Color(0x0c121a);
        if (this.rainParticles) this.rainParticles.visible = true;
        break;
    }
  }

  public update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (this.rainParticles && this.rainParticles.visible && this.rainGeometry) {
      // Keep rain box centered around camera
      this.rainParticles.position.copy(cameraPosition);

      const posAttr = this.rainGeometry.getAttribute('position') as THREE.BufferAttribute;
      const velAttr = this.rainGeometry.getAttribute('velocity') as THREE.BufferAttribute;
      const positions = posAttr.array as Float32Array;
      const velocities = velAttr.array as Float32Array;

      for (let i = 0; i < this.rainCount; i++) {
        positions[i * 3 + 1] -= velocities[i] * deltaSeconds;
        // Reset rain drop to top when it hits ground
        if (positions[i * 3 + 1] < -5) {
          positions[i * 3 + 1] = 35 + Math.random() * 5;
        }
      }
      posAttr.needsUpdate = true;
    }
  }

  public getTrackWetness(): number {
    return this.trackWetness;
  }

  public getPreset(): WeatherPreset {
    return this.currentPreset;
  }
}
