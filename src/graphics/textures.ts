import * as THREE from 'three';

/**
 * Procedural Carrara Marble Texture with warm gold and soft grey mineral veins
 */
export function createCarraraMarbleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(c);

  ctx.fillStyle = '#f5f2eb';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 36; i++) {
    ctx.beginPath();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (Math.random() - 0.45) * 65;
      y += (Math.random() - 0.45) * 65;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(212, 175, 55, 0.22)' : 'rgba(120, 115, 110, 0.16)';
    ctx.lineWidth = 1 + Math.random() * 2.5;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Procedural Volcanic Obsidian Texture with deep violet and crimson arcane fissures
 */
export function createVolcanicObsidianTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(c);

  ctx.fillStyle = '#120f1a';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 38; i++) {
    ctx.beginPath();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    ctx.moveTo(x, y);
    for (let s = 0; s < 10; s++) {
      x += (Math.random() - 0.5) * 58;
      y += (Math.random() - 0.5) * 58;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(220, 38, 38, 0.32)' : 'rgba(168, 85, 247, 0.36)';
    ctx.lineWidth = 1 + Math.random() * 2.2;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Procedural Polychrome Cosmati Pavement with porphyry red, serpentine green & gold medallions
 */
export function createCosmatiPavementTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(c);

  ctx.fillStyle = '#191620';
  ctx.fillRect(0, 0, 1024, 1024);

  // Outer border bands
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 10;
  ctx.strokeRect(24, 24, 976, 976);

  const cx = 512, cy = 512;
  const rings = [
    { r: 440, color: '#3b151e' },
    { r: 390, color: '#d4af37' },
    { r: 365, color: '#143328' },
    { r: 280, color: '#2b2536' },
    { r: 210, color: '#4c1824' },
    { r: 120, color: '#d4af37' }
  ];

  rings.forEach(ring => {
    ctx.beginPath();
    ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
    ctx.fillStyle = ring.color;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e5dccb';
    ctx.stroke();
  });

  // 16-Pointed Basilica Compass Star
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * 435, cy + Math.sin(angle) * 435);
    ctx.strokeStyle = 'rgba(229, 193, 88, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Corner Quatrefoil Rondels
  [[190, 190], [834, 190], [190, 834], [834, 834]].forEach(([rx, ry]) => {
    ctx.beginPath();
    ctx.arc(rx, ry, 105, 0, Math.PI * 2);
    ctx.fillStyle = '#4a1822';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#d4af37';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(rx, ry, 55, 0, Math.PI * 2);
    ctx.fillStyle = '#17382b';
    ctx.fill();
  });

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

/**
 * Procedural Pointed Lancet Stained-Glass Window
 */
export function createLancetStainedGlassTexture(paletteIndex: number = 0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(c);

  const palettes = [
    ['#1e3a8a', '#2563eb', '#dc2626', '#f59e0b', '#10b981'], // Marian Blue & Ruby
    ['#7f1d1d', '#dc2626', '#f59e0b', '#3b82f6', '#fef08a'], // Sacred Heart Crimson & Gold
    ['#065f46', '#10b981', '#2563eb', '#eab308', '#9333ea']  // Emerald & Amethyst
  ];
  const pal = palettes[paletteIndex % palettes.length]!;

  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, pal[0]!);
  grad.addColorStop(0.5, pal[1]!);
  grad.addColorStop(1, pal[2]!);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 512);

  for (let y = 48; y < 480; y += 68) {
    ctx.beginPath();
    ctx.arc(128, y, 28, 0, Math.PI * 2);
    ctx.fillStyle = pal[3]!;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#09090b';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(128, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = pal[4]!;
    ctx.fill();
  }

  // Lead came mullions
  ctx.strokeStyle = '#09090b';
  ctx.lineWidth = 7;
  ctx.strokeRect(8, 8, 240, 496);
  ctx.beginPath();
  ctx.moveTo(85, 0); ctx.lineTo(85, 512);
  ctx.moveTo(171, 0); ctx.lineTo(171, 512);
  ctx.stroke();

  return new THREE.CanvasTexture(c);
}

/**
 * Procedural Radiant Rose Window Texture
 */
export function createRoseWindowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(c);

  const cx = 256, cy = 256;
  const radGrad = ctx.createRadialGradient(cx, cy, 18, cx, cy, 250);
  radGrad.addColorStop(0, '#fef08a');
  radGrad.addColorStop(0.28, '#dc2626');
  radGrad.addColorStop(0.62, '#1d4ed8');
  radGrad.addColorStop(0.88, '#6d28d9');
  radGrad.addColorStop(1, '#09090b');

  ctx.fillStyle = radGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 248, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 245, cy + Math.sin(a) * 245);
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 6;
    ctx.stroke();

    const px = cx + Math.cos(a + Math.PI / 16) * 165;
    const py = cy + Math.sin(a + Math.PI / 16) * 165;
    ctx.beginPath();
    ctx.arc(px, py, 24, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? '#facc15' : '#38bdf8';
    ctx.fill();
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

/**
 * Procedural 3D board tile texture for light and dark squares
 */
export function createBoardTileTexture(isLight: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(c);

  if (isLight) {
    ctx.fillStyle = '#EAE4D7';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      let x = Math.random() * 256;
      let y = Math.random() * 256;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (Math.random() - 0.5) * 55;
        y += (Math.random() - 0.5) * 55;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(205, 168, 72, 0.30)' : 'rgba(135, 128, 118, 0.22)';
      ctx.lineWidth = 1.2 + Math.random() * 2.0;
      ctx.stroke();
    }

    ctx.strokeStyle = '#FDFBF7';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 248, 248);

    ctx.strokeStyle = 'rgba(180, 148, 65, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, 236, 236);
  } else {
    ctx.fillStyle = '#181A22';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      let x = Math.random() * 256;
      let y = Math.random() * 256;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (Math.random() - 0.5) * 55;
        y += (Math.random() - 0.5) * 55;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(139, 92, 246, 0.25)' : 'rgba(71, 85, 105, 0.30)';
      ctx.lineWidth = 1.2 + Math.random() * 2.0;
      ctx.stroke();
    }

    ctx.strokeStyle = '#0D0E14';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 248, 248);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, 236, 236);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

/**
 * Generates high-res Cinzel letter/digit canvas texture for board border algebraic notations
 */
export function createCoordinateTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(c);

  ctx.font = 'bold 38px Cinzel, serif';
  ctx.fillStyle = '#fde68a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);
  return new THREE.CanvasTexture(c);
}
