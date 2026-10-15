import * as THREE from 'three';
import {
  createCarraraMarbleTexture,
  createCosmatiPavementTexture,
  createVolcanicObsidianTexture
} from './textures';

export interface AppMaterials {
  marbleTex: THREE.CanvasTexture;
  obsidianTex: THREE.CanvasTexture;
  cosmatiTex: THREE.CanvasTexture;
  whitePieceMaterial: THREE.MeshStandardMaterial;
  blackPieceMaterial: THREE.MeshStandardMaterial;
  goldAccentMaterial: THREE.MeshStandardMaterial;
  arcaneAccentMaterial: THREE.MeshStandardMaterial;
  steelBladeMaterial: THREE.MeshStandardMaterial;
  flameMat: THREE.MeshBasicMaterial;
  darkStoneMat: THREE.MeshStandardMaterial;
  trimStoneMat: THREE.MeshStandardMaterial;
  darkOakMat: THREE.MeshStandardMaterial;
  crimsonCarpetMat: THREE.MeshStandardMaterial;
}

export function createMaterials(): AppMaterials {
  const marbleTex = createCarraraMarbleTexture();
  const obsidianTex = createVolcanicObsidianTexture();
  const cosmatiTex = createCosmatiPavementTexture();

  const whitePieceMaterial = new THREE.MeshStandardMaterial({
    color: 0xf7f4ee,
    map: marbleTex,
    roughness: 0.22,
    metalness: 0.08
  });

  const blackPieceMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c1726,
    map: obsidianTex,
    roughness: 0.16,
    metalness: 0.42
  });

  const goldAccentMaterial = new THREE.MeshStandardMaterial({
    color: 0xe5c158,
    roughness: 0.22,
    metalness: 0.88,
    emissive: 0x3b2a08,
    emissiveIntensity: 0.22
  });

  const arcaneAccentMaterial = new THREE.MeshStandardMaterial({
    color: 0xa855f7,
    roughness: 0.2,
    metalness: 0.72,
    emissive: 0x6b21a8,
    emissiveIntensity: 0.65
  });

  const steelBladeMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6d3d1,
    roughness: 0.18,
    metalness: 0.92
  });

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffd54f
  });

  const darkStoneMat = new THREE.MeshStandardMaterial({
    color: 0x221f29,
    roughness: 0.86,
    metalness: 0.08
  });

  const trimStoneMat = new THREE.MeshStandardMaterial({
    color: 0x353040,
    roughness: 0.72,
    metalness: 0.12
  });

  const darkOakMat = new THREE.MeshStandardMaterial({
    color: 0x362214,
    roughness: 0.58,
    metalness: 0.08
  });

  const crimsonCarpetMat = new THREE.MeshStandardMaterial({
    color: 0x69141e,
    roughness: 0.88,
    metalness: 0.04
  });

  return {
    marbleTex,
    obsidianTex,
    cosmatiTex,
    whitePieceMaterial,
    blackPieceMaterial,
    goldAccentMaterial,
    arcaneAccentMaterial,
    steelBladeMaterial,
    flameMat,
    darkStoneMat,
    trimStoneMat,
    darkOakMat,
    crimsonCarpetMat
  };
}
