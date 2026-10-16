import * as THREE from 'three';
import type { CameraPreset, CameraState } from '../types';

export const CAMERA_PRESETS: CameraPreset[] = [
  { name: 'White Nave', theta: 0, phi: 0.96, radius: 25.5, target: new THREE.Vector3(0, 0.8, 0) },
  { name: 'Sanctuary Orbit', theta: 0.42, phi: 1.08, radius: 27.5, target: new THREE.Vector3(0, 2.2, -3.5) },
  { name: 'Black Apse', theta: Math.PI, phi: 0.96, radius: 25.5, target: new THREE.Vector3(0, 0.8, 0) },
  { name: 'Overhead Crossing', theta: 0, phi: 0.22, radius: 29.0, target: new THREE.Vector3(0, 0, 0) },
  { name: 'Choir Side View', theta: Math.PI / 2, phi: 1.02, radius: 25.0, target: new THREE.Vector3(0, 1.0, 0) }
];

export class CameraController {
  public camState: CameraState = {
    theta: 0,
    phi: 0.96,
    radius: 25.5,
    target: new THREE.Vector3(0, 0.8, 0)
  };

  private currentCamPos = new THREE.Vector3(0, 16, 22);
  private currentLookAt = new THREE.Vector3(0, 0.8, 0);
  public currentPresetIdx = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  public cyclePreset(): CameraPreset {
    this.currentPresetIdx = (this.currentPresetIdx + 1) % CAMERA_PRESETS.length;
    const preset = CAMERA_PRESETS[this.currentPresetIdx]!;
    this.applyPreset(preset);
    return preset;
  }

  public applyPreset(preset: CameraPreset): void {
    this.camState.theta = preset.theta;
    this.camState.phi = preset.phi;
    this.camState.radius = preset.radius;
    this.camState.target.copy(preset.target);
  }

  public update(cameraShakeIntensity: number): void {
    const desiredX = this.camState.target.x + this.camState.radius * Math.sin(this.camState.phi) * Math.sin(this.camState.theta);
    const desiredY = this.camState.target.y + this.camState.radius * Math.cos(this.camState.phi);
    const desiredZ = this.camState.target.z + this.camState.radius * Math.sin(this.camState.phi) * Math.cos(this.camState.theta);

    this.currentCamPos.lerp(new THREE.Vector3(desiredX, desiredY, desiredZ), 0.09);
    this.currentLookAt.lerp(this.camState.target, 0.1);

    this.camera.position.copy(this.currentCamPos);

    if (cameraShakeIntensity > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * cameraShakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * cameraShakeIntensity;
    }

    this.camera.lookAt(this.currentLookAt);
  }
}
