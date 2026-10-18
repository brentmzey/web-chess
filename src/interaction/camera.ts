import * as THREE from 'three';
import type { CameraPreset, CameraState } from '../types';

export const CAMERA_PRESETS: CameraPreset[] = [
  { name: 'White Nave', theta: 0, phi: 0.96, radius: 25.5, target: new THREE.Vector3(0, 0.8, 0) },
  { name: 'Sanctuary Orbit', theta: 0.42, phi: 1.08, radius: 27.5, target: new THREE.Vector3(0, 2.2, -3.5) },
  { name: 'Black Apse', theta: Math.PI, phi: 0.96, radius: 25.5, target: new THREE.Vector3(0, 0.8, 0) },
  { name: 'Overhead Crossing', theta: 0, phi: 0.22, radius: 29.0, target: new THREE.Vector3(0, 0, 0) },
  { name: 'Choir Side View', theta: Math.PI / 2, phi: 1.02, radius: 25.0, target: new THREE.Vector3(0, 1.0, 0) }
];

/**
 * Computes an aspect-ratio-adjusted camera distance so portrait mobile screens
 * stay strictly inside the Basilica crossing piers and in front of the South Organ / Rose Window
 * (never exceeding radius 24.5 on portrait), preventing wall/window occlusion.
 */
export function computeAspectAdjustedRadius(baseRadius: number, aspect: number): number {
  if (!Number.isFinite(aspect) || aspect >= 1.0) {
    return baseRadius;
  }
  return Math.min(24.5, Math.max(13.5, baseRadius * 0.92));
}

/**
 * Computes an aspect-ratio-adjusted vertical FOV (in degrees) for Three.js PerspectiveCamera
 * so narrow portrait screens (aspect < 1.0) preserve full horizontal board visibility (a1..h8)
 * without pushing the camera backward through the cathedral walls.
 */
export function computeAspectAdjustedFov(baseFov: number, aspect: number): number {
  if (!Number.isFinite(aspect) || aspect >= 1.0) {
    return baseFov;
  }
  const safeAspect = Math.max(0.35, aspect);
  // Preserve horizontal half-angle tangent >= 0.43 so the full 18.6u board rim fits at radius ~23.5
  const minTanHalfH = 0.43;
  const requiredTanHalfV = minTanHalfH / safeAspect;
  const computedFov = (2 * Math.atan(requiredTanHalfV) * 180) / Math.PI;
  return Math.min(86, Math.max(baseFov, computedFov));
}

/**
 * Computes an aspect-ratio-adjusted polar angle (phi) so portrait mobile screens
 * view the chessboard from a slightly higher overhead angle, preventing front-rank pieces
 * from occluding back-rank squares during touch selection and keeping horizontal distance inside the nave piers.
 */
export function computeAspectAdjustedPhi(basePhi: number, aspect: number): number {
  if (!Number.isFinite(aspect) || aspect >= 1.0) {
    return basePhi;
  }
  return Math.max(0.18, Math.min(0.72, basePhi * 0.72));
}

export class CameraController {
  public camState: CameraState = {
    theta: 0,
    phi: 0.96,
    radius: 25.5,
    target: new THREE.Vector3(0, 0.8, 0)
  };

  private currentCamPos = new THREE.Vector3(0, 18.5, 15.5);
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
    const aspect = this.camera.aspect || 1.0;
    const targetFov = computeAspectAdjustedFov(45, aspect);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix?.();
    }

    const effectiveRadius = computeAspectAdjustedRadius(this.camState.radius, aspect);
    const effectivePhi = computeAspectAdjustedPhi(this.camState.phi, aspect);

    const desiredX =
      this.camState.target.x +
      effectiveRadius * Math.sin(effectivePhi) * Math.sin(this.camState.theta);
    const desiredY =
      this.camState.target.y + effectiveRadius * Math.cos(effectivePhi);
    const desiredZ =
      this.camState.target.z +
      effectiveRadius * Math.sin(effectivePhi) * Math.cos(this.camState.theta);

    this.currentCamPos.lerp(new THREE.Vector3(desiredX, desiredY, desiredZ), 0.14);
    this.currentLookAt.lerp(this.camState.target, 0.14);

    this.camera.position.copy(this.currentCamPos);

    if (cameraShakeIntensity > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * cameraShakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * cameraShakeIntensity;
    }

    this.camera.lookAt(this.currentLookAt);
  }
}

