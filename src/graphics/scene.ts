import * as THREE from 'three';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  strikeFlashLight: THREE.PointLight;
  altarWarmLight: THREE.PointLight;
  boardKeyLight: THREE.PointLight;
}

export function initScene(container: HTMLElement): SceneContext {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x09070e);
  scene.fog = new THREE.FogExp2(0x0b0914, 0.0135);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 180);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  container.appendChild(renderer.domElement);

  // Cathedral Ambient / Hemisphere Lighting
  const hemiLight = new THREE.HemisphereLight(0xd8c8ff, 0x261d16, 0.58);
  scene.add(hemiLight);

  // Main Crossing Vault Key Spotlight
  const crossingSpot = new THREE.SpotLight(0xfff4dc, 1.95);
  crossingSpot.position.set(6, 29, 8);
  crossingSpot.angle = Math.PI / 3.2;
  crossingSpot.penumbra = 0.65;
  crossingSpot.decay = 1.2;
  crossingSpot.distance = 85;
  crossingSpot.castShadow = true;
  crossingSpot.shadow.mapSize.width = 2048;
  crossingSpot.shadow.mapSize.height = 2048;
  crossingSpot.shadow.bias = -0.0005;
  scene.add(crossingSpot);

  // Dedicated Overhead Board Illumination
  const boardKeyLight = new THREE.PointLight(0xfff9eb, 1.15, 36, 1.5);
  boardKeyLight.position.set(0, 14.5, 0);
  scene.add(boardKeyLight);

  // Clerestory Stained Glass Rim Directional Light
  const clerestoryLight = new THREE.DirectionalLight(0x93c5fd, 0.55);
  clerestoryLight.position.set(-22, 20, -6);
  scene.add(clerestoryLight);

  // High Altar Warm Candlelight Fill
  const altarWarmLight = new THREE.PointLight(0xffb74d, 1.45, 38, 1.6);
  altarWarmLight.position.set(0, 5.8, -19.5);
  scene.add(altarWarmLight);

  // Dynamic Melee Strike Flash Light
  const strikeFlashLight = new THREE.PointLight(0xfef08a, 0, 18, 2);
  scene.add(strikeFlashLight);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    scene,
    camera,
    renderer,
    strikeFlashLight,
    altarWarmLight,
    boardKeyLight
  };
}
