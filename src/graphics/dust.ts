import * as THREE from 'three';

export interface DustSystem {
  dustParticles: THREE.Points;
  updateDust: (dt: number, elapsed: number) => void;
}

export function buildDustParticles(scene: THREE.Scene, dustCount: number = 300): DustSystem {
  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);

  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 42;
    dustPositions[i * 3 + 1] = Math.random() * 24 + 0.5;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 48;
  }

  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

  const dustMat = new THREE.PointsMaterial({
    color: 0xfde68a,
    size: 0.15,
    transparent: true,
    opacity: 0.48,
    blending: THREE.AdditiveBlending
  });

  const dustParticles = new THREE.Points(dustGeo, dustMat);
  scene.add(dustParticles);

  const updateDust = (dt: number, elapsed: number): void => {
    const posAttr = dustGeo.attributes['position'] as THREE.BufferAttribute;
    if (!posAttr) return;

    for (let i = 0; i < dustCount; i++) {
      let y = posAttr.getY(i) + dt * 0.38;
      let x = posAttr.getX(i) + Math.sin(elapsed * 0.6 + i) * 0.008;
      if (y > 25) y = 0.2;
      posAttr.setXY(i, x, y);
    }
    posAttr.needsUpdate = true;
  };

  return {
    dustParticles,
    updateDust
  };
}
