import * as THREE from 'three';
import type { CathedralSoundEngine } from '../audio/CathedralSoundEngine';
import type { ShardParticle, ShockwaveRing } from '../types';
import type { AppMaterials } from './materials';

export class ShatterSystem {
  public activeShards: ShardParticle[] = [];
  public activeShockwaves: ShockwaveRing[] = [];
  public cameraShakeIntensity: number = 0;

  constructor(
    private scene: THREE.Scene,
    private materials: AppMaterials,
    private soundFX: CathedralSoundEngine,
    private strikeFlashLight: THREE.PointLight
  ) {}

  /**
   * Shatters a captured piece into 34 physics-driven marble or obsidian stone shards
   */
  public spawnShatterExplosion(
    victimPiece: THREE.Group,
    impactDir: THREE.Vector3
  ): void {
    const origin = victimPiece.position.clone();
    const color = victimPiece.userData?.color ?? 'b';
    const shardMat = color === 'w' ? this.materials.whitePieceMaterial : this.materials.blackPieceMaterial;
    const accentMat = color === 'w' ? this.materials.goldAccentMaterial : this.materials.arcaneAccentMaterial;

    this.soundFX.playMeleeShatter();
    this.cameraShakeIntensity = 0.55;

    // Brief Sanctuary Flash at Point of Impact
    this.strikeFlashLight.position.set(origin.x, 2.2, origin.z);
    this.strikeFlashLight.intensity = 4.5;

    for (let i = 0; i < 34; i++) {
      const size = 0.13 + Math.random() * 0.25;
      const geo = i % 3 === 0
        ? new THREE.OctahedronGeometry(size, 0)
        : new THREE.DodecahedronGeometry(size, 0);
      const mesh = new THREE.Mesh(geo, i % 5 === 0 ? accentMat : shardMat);
      mesh.scale.set(
        0.6 + Math.random() * 0.9,
        0.5 + Math.random() * 1.1,
        0.6 + Math.random() * 0.9
      );
      mesh.position.set(
        origin.x + (Math.random() - 0.5) * 0.7,
        0.4 + Math.random() * 2.2,
        origin.z + (Math.random() - 0.5) * 0.7
      );
      mesh.castShadow = true;
      this.scene.add(mesh);

      const spreadAngle = Math.random() * Math.PI * 2;
      const speed = 2.6 + Math.random() * 6.8;
      const vel = new THREE.Vector3(
        Math.cos(spreadAngle) * speed + impactDir.x * 4.5,
        3.6 + Math.random() * 6.8,
        Math.sin(spreadAngle) * speed + impactDir.z * 4.5
      );

      this.activeShards.push({
        mesh,
        vel,
        rotVel: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14
        ),
        life: 1.0
      });
    }

    // Expanding Arcane Shockwave Ring
    const ringGeo = new THREE.RingGeometry(0.2, 0.55, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: color === 'w' ? 0xfacc15 : 0xa855f7,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(origin.x, 0.05, origin.z);
    this.scene.add(ringMesh);
    this.activeShockwaves.push({ mesh: ringMesh, scale: 1, opacity: 0.95 });

    this.scene.remove(victimPiece);
  }

  public update(dt: number): void {
    // Decay flash
    if (this.strikeFlashLight.intensity > 0.01) {
      this.strikeFlashLight.intensity *= 0.82;
    }

    // Shard physics simulation
    for (let i = this.activeShards.length - 1; i >= 0; i--) {
      const s = this.activeShards[i]!;
      s.vel.y -= 19.5 * dt; // Gravity
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.rotVel.x * dt;
      s.mesh.rotation.y += s.rotVel.y * dt;
      s.mesh.rotation.z += s.rotVel.z * dt;

      // Bounce on Chessboard / Sanctuary Dais
      if (s.mesh.position.y < 0.08) {
        s.mesh.position.y = 0.08;
        s.vel.y *= -0.42;
        s.vel.x *= 0.72;
        s.vel.z *= 0.72;
        s.rotVel.multiplyScalar(0.75);
      }

      s.life -= dt * 0.36;
      if (s.life < 0.35) {
        s.mesh.scale.multiplyScalar(0.95);
      }
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.activeShards.splice(i, 1);
      }
    }

    // Shockwave expansion
    for (let i = this.activeShockwaves.length - 1; i >= 0; i--) {
      const sw = this.activeShockwaves[i]!;
      sw.scale += dt * 7.5;
      sw.opacity -= dt * 1.4;
      sw.mesh.scale.set(sw.scale, sw.scale, 1);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, sw.opacity);
      if (sw.opacity <= 0) {
        this.scene.remove(sw.mesh);
        this.activeShockwaves.splice(i, 1);
      }
    }
  }
}
