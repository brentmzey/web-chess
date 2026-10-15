import * as THREE from 'three';
import type { CandleFlameData, ThuribleData } from '../types';
import type { AppMaterials } from './materials';
import {
  createLancetStainedGlassTexture,
  createRoseWindowTexture
} from './textures';

export interface CathedralElements {
  cathedralGroup: THREE.Group;
  swingingThuribles: ThuribleData[];
  candleFlames: CandleFlameData[];
}

export function buildGothicCathedral(scene: THREE.Scene, materials: AppMaterials): CathedralElements {
  const cathedralGroup = new THREE.Group();
  const swingingThuribles: ThuribleData[] = [];
  const candleFlames: CandleFlameData[] = [];

  const {
    cosmatiTex,
    whitePieceMaterial,
    goldAccentMaterial,
    flameMat,
    darkStoneMat,
    trimStoneMat,
    darkOakMat,
    crimsonCarpetMat
  } = materials;

  // 1. Cosmati Polychrome Marble Basilica Floor
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 96),
    new THREE.MeshStandardMaterial({
      map: cosmatiTex,
      roughness: 0.28,
      metalness: 0.12
    })
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -0.88;
  floorMesh.receiveShadow = true;
  cathedralGroup.add(floorMesh);

  // 2. Stepped Crossing Altar Dais (Strictly below y = -0.16)
  const daisSteps = [
    { w: 23.6, d: 23.6, h: 0.28, y: -0.78 },
    { w: 21.4, d: 21.4, h: 0.28, y: -0.50 },
    { w: 19.8, d: 19.8, h: 0.28, y: -0.32 }
  ];
  daisSteps.forEach((st, idx) => {
    const stepMesh = new THREE.Mesh(
      new THREE.BoxGeometry(st.w, st.h, st.d),
      idx === 2 ? trimStoneMat : darkStoneMat
    );
    stepMesh.position.y = st.y;
    stepMesh.receiveShadow = true;
    cathedralGroup.add(stepMesh);
  });

  // Ornate Brass & Basalt Outer Border Frame
  const frameRim = new THREE.Mesh(
    new THREE.BoxGeometry(18.6, 0.24, 18.6),
    goldAccentMaterial
  );
  frameRim.position.y = -0.28;
  frameRim.receiveShadow = true;
  cathedralGroup.add(frameRim);

  const subBoardBed = new THREE.Mesh(
    new THREE.BoxGeometry(17.6, 0.16, 17.6),
    darkStoneMat
  );
  subBoardBed.position.y = -0.24;
  subBoardBed.receiveShadow = true;
  cathedralGroup.add(subBoardBed);

  // 3. NORTH SANCTUARY APSE: Stepped Presbytery, Baldacchino Canopy, High Altar, Tabernacle & Candlesticks
  const presbyteryGroup = new THREE.Group();
  presbyteryGroup.position.set(0, -0.88, -21.0);

  // Three Sanctuary Steps leading to High Altar
  for (let s = 0; s < 3; s++) {
    const pStep = new THREE.Mesh(
      new THREE.BoxGeometry(24 - s * 2, 0.38, 12 - s * 1.2),
      trimStoneMat
    );
    pStep.position.set(0, 0.19 + s * 0.38, -s * 0.6);
    pStep.receiveShadow = true;
    presbyteryGroup.add(pStep);
  }

  // Marble Communion Altar Rail with Brass Colonnettes
  [-8.2, 8.2].forEach(rx => {
    const railTop = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.18, 0.45), whitePieceMaterial);
    railTop.position.set(rx, 1.35, 5.2);
    presbyteryGroup.add(railTop);
    for (let b = -3; b <= 3; b += 1.5) {
      const baluster = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.1, 8), goldAccentMaterial);
      baluster.position.set(rx + b, 0.75, 5.2);
      presbyteryGroup.add(baluster);
    }
  });

  // High Altar Mensa
  const mensa = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.65, 2.6), whitePieceMaterial);
  mensa.position.set(0, 1.95, -1.2);
  mensa.castShadow = true;
  mensa.receiveShadow = true;
  presbyteryGroup.add(mensa);

  const frontal = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.25, 2.66), crimsonCarpetMat);
  frontal.position.set(0, 1.90, -1.2);
  presbyteryGroup.add(frontal);

  // Golden Tabernacle & Dome
  const tabernacleBase = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 1.35, 12), goldAccentMaterial);
  tabernacleBase.position.set(0, 3.45, -1.3);
  presbyteryGroup.add(tabernacleBase);

  const tabernacleDome = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), goldAccentMaterial);
  tabernacleDome.position.set(0, 4.12, -1.3);
  presbyteryGroup.add(tabernacleDome);

  // Towering Golden Altar Crucifix
  const crossShaft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), goldAccentMaterial);
  crossShaft.position.set(0, 5.45, -1.3);
  presbyteryGroup.add(crossShaft);
  const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 0.16), goldAccentMaterial);
  crossBeam.position.set(0, 5.95, -1.3);
  presbyteryGroup.add(crossBeam);

  // Six Towering Flickering Brass Altar Candlesticks
  [-3.4, -2.4, -1.4, 1.4, 2.4, 3.4].forEach((cx, cIdx) => {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 1.25, 10), goldAccentMaterial);
    stick.position.set(cx, 3.4, -1.1);
    presbyteryGroup.add(stick);

    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.85, 10), whitePieceMaterial);
    wax.position.set(cx, 4.25, -1.1);
    presbyteryGroup.add(wax);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 8), flameMat);
    flame.position.set(cx, 4.82, -1.1);
    presbyteryGroup.add(flame);
    candleFlames.push({ mesh: flame, baseY: 4.82, phase: cIdx * 1.1 });
  });

  // 4-Column Gothic Baldacchino over High Altar
  const baldacchinoCols = [[-4.5, -3.4], [4.5, -3.4], [-4.5, 1.2], [4.5, 1.2]];
  baldacchinoCols.forEach(([bx, bz]) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 10.5, 14), goldAccentMaterial);
    col.position.set(bx!, 6.3, bz!);
    col.castShadow = true;
    presbyteryGroup.add(col);
  });

  const canopyRoof = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.9, 5.8), trimStoneMat);
  canopyRoof.position.set(0, 11.8, -1.1);
  presbyteryGroup.add(canopyRoof);

  const canopySpire = new THREE.Mesh(new THREE.ConeGeometry(5.6, 5.5, 4), goldAccentMaterial);
  canopySpire.rotation.y = Math.PI / 4;
  canopySpire.position.set(0, 14.9, -1.1);
  presbyteryGroup.add(canopySpire);

  cathedralGroup.add(presbyteryGroup);

  // 4. Clustered Basilica Nave Piers, Ribbed Groin Vaults & Triforium Arches
  const zBays = [-22, -11, 0, 11, 22];
  zBays.forEach((zPos, bIdx) => {
    [-16.2, 16.2].forEach(xPos => {
      const pierGroup = new THREE.Group();
      pierGroup.position.set(xPos, -0.88, zPos);

      // Core Pier + 4 Clustered Gothic Shafts
      const corePier = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 25.5, 12), trimStoneMat);
      corePier.position.y = 12.75;
      corePier.castShadow = true;
      corePier.receiveShadow = true;
      pierGroup.add(corePier);

      [[0.95, 0], [-0.95, 0], [0, 0.95], [0, -0.95]].forEach(([sx, sz]) => {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 25.5, 10), darkStoneMat);
        shaft.position.set(sx!, 12.75, sz!);
        pierGroup.add(shaft);
      });

      // Gilded Foliate Capital
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.2, 1.1, 12), goldAccentMaterial);
      cap.position.y = 25.0;
      pierGroup.add(cap);

      cathedralGroup.add(pierGroup);
    });

    // Overhead Transverse Vault Rib Arch
    const archGeo = new THREE.TorusGeometry(16.2, 0.44, 10, 32, Math.PI);
    const archMesh = new THREE.Mesh(archGeo, trimStoneMat);
    archMesh.position.set(0, 24.2, zPos);
    cathedralGroup.add(archMesh);

    // Gilded Vault Keystone Boss
    const boss = new THREE.Mesh(new THREE.OctahedronGeometry(0.72, 1), goldAccentMaterial);
    boss.position.set(0, 40.2, zPos);
    cathedralGroup.add(boss);

    // Diagonal Quadripartite Groin Ribs between Bays
    if (bIdx < zBays.length - 1) {
      const midZ = (zPos + zBays[bIdx + 1]!) / 2;
      const centerBoss = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 1), goldAccentMaterial);
      centerBoss.position.set(0, 39.8, midZ);
      cathedralGroup.add(centerBoss);

      [-1, 1].forEach(diagSign => {
        const diagRib = new THREE.Mesh(
          new THREE.TorusGeometry(18.8, 0.26, 8, 28, Math.PI),
          trimStoneMat
        );
        diagRib.position.set(0, 24.2, midZ);
        diagRib.rotation.y = diagSign * 0.34;
        cathedralGroup.add(diagRib);
      });

      // Nave Arcade Arches & Triforium Colonnettes along East & West Walls
      [-16.2, 16.2].forEach(wallX => {
        const arcadeArch = new THREE.Mesh(
          new THREE.TorusGeometry(5.5, 0.34, 8, 20, Math.PI),
          trimStoneMat
        );
        arcadeArch.rotation.y = Math.PI / 2;
        arcadeArch.position.set(wallX, 9.8, midZ);
        cathedralGroup.add(arcadeArch);

        const triforiumLintel = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.45, 11.0),
          trimStoneMat
        );
        triforiumLintel.position.set(wallX, 15.6, midZ);
        cathedralGroup.add(triforiumLintel);

        for (let tc = -4; tc <= 4; tc += 2) {
          const tCol = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.16, 2.6, 8),
            goldAccentMaterial
          );
          tCol.position.set(wallX, 17.0, midZ + tc);
          cathedralGroup.add(tCol);
        }
      });
    }
  });

  // Semi-Circular North Apse Colonnade
  for (let a = 0; a <= 6; a++) {
    const angle = Math.PI + (a / 6) * Math.PI;
    const ax = Math.cos(angle) * 16.2;
    const az = -22 + Math.sin(angle) * 10.5;
    const apseCol = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.85, 25, 12),
      trimStoneMat
    );
    apseCol.position.set(ax, 11.6, az);
    cathedralGroup.add(apseCol);
  }

  // 5. Suspended Ruby-Glass Sanctuary Lamp (Eternal Flame)
  const sanctuaryLampGroup = new THREE.Group();
  sanctuaryLampGroup.position.set(4.6, 24.5, -15.5);

  const lampChain = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 17.2, 6),
    goldAccentMaterial
  );
  lampChain.position.y = -8.6;
  sanctuaryLampGroup.add(lampChain);

  const rubyGlassMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0xff1e1e,
    emissiveIntensity: 1.5,
    roughness: 0.12,
    metalness: 0.1,
    transparent: true,
    opacity: 0.94
  });
  const rubyVessel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.2, 0.78, 14),
    rubyGlassMat
  );
  rubyVessel.position.y = -17.3;
  sanctuaryLampGroup.add(rubyVessel);

  const brassHolder = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.06, 8, 16),
    goldAccentMaterial
  );
  brassHolder.rotation.x = Math.PI / 2;
  brassHolder.position.y = -17.25;
  sanctuaryLampGroup.add(brassHolder);

  const eternalLight = new THREE.PointLight(0xff2222, 1.45, 18, 1.8);
  eternalLight.position.set(0, -17.2, 0);
  sanctuaryLampGroup.add(eternalLight);

  cathedralGroup.add(sanctuaryLampGroup);
  swingingThuribles.push({
    group: sanctuaryLampGroup,
    speed: 0.82,
    phase: 1.1,
    ampX: 0.025,
    ampZ: 0.018
  });

  // 6. Grand West Gallery Pipe Organ Facade
  const southOrganGroup = new THREE.Group();
  southOrganGroup.position.set(0, 11.5, 29.5);
  southOrganGroup.rotation.y = Math.PI;

  const organCase = new THREE.Mesh(new THREE.BoxGeometry(16.8, 8.2, 1.8), darkOakMat);
  southOrganGroup.add(organCase);

  const pewterPipeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.92
  });

  for (let p = -15; p <= 15; p++) {
    const dist = Math.abs(p);
    const towerBoost = (dist < 3 || (dist > 9 && dist < 14)) ? 2.2 : 0.0;
    const pipeH = 3.4 + (15 - dist) * 0.22 + towerBoost;
    const pipeR = dist < 4 ? 0.17 : 0.115;
    const pipeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(pipeR, pipeR * 0.85, pipeH, 10),
      p % 3 === 0 ? goldAccentMaterial : pewterPipeMat
    );
    pipeMesh.position.set(p * 0.48, -1.4 + pipeH / 2, 0.96);
    southOrganGroup.add(pipeMesh);
  }
  cathedralGroup.add(southOrganGroup);

  // North & South Radiant Rose Windows
  const roseTex = createRoseWindowTexture();
  const roseMat = new THREE.MeshBasicMaterial({ map: roseTex, side: THREE.DoubleSide });

  [-31.8, 30.5].forEach((rz, idx) => {
    const roseMesh = new THREE.Mesh(new THREE.CircleGeometry(7.6, 48), roseMat);
    roseMesh.position.set(0, 23.2, rz);
    cathedralGroup.add(roseMesh);

    const roseRing = new THREE.Mesh(
      new THREE.TorusGeometry(7.7, 0.55, 12, 48),
      trimStoneMat
    );
    roseRing.position.set(0, 23.2, rz + (idx === 0 ? 0.15 : -0.15));
    cathedralGroup.add(roseRing);
  });

  // 7. Clerestory Pointed Lancet Stained-Glass Windows & Volumetric God-Rays
  const lancetTextures = [
    createLancetStainedGlassTexture(0),
    createLancetStainedGlassTexture(1),
    createLancetStainedGlassTexture(2)
  ];

  const rayMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.044,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  [-16.5, -5.5, 5.5, 16.5].forEach((wz, wIdx) => {
    [-21.2, 21.2].forEach((wx, sideIdx) => {
      const winGroup = new THREE.Group();
      winGroup.position.set(wx, 14.8, wz);
      winGroup.rotation.y = sideIdx === 0 ? Math.PI / 2 : -Math.PI / 2;

      const glassMat = new THREE.MeshBasicMaterial({
        map: lancetTextures[(wIdx + sideIdx) % lancetTextures.length],
        side: THREE.DoubleSide
      });

      const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 9.2), glassMat);
      winGroup.add(pane);

      const archHead = new THREE.Mesh(
        new THREE.CircleGeometry(1.9, 16, 0, Math.PI),
        glassMat
      );
      archHead.position.y = 4.6;
      winGroup.add(archHead);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(4.3, 9.6, 0.45),
        darkStoneMat
      );
      frame.position.z = -0.25;
      winGroup.add(frame);

      cathedralGroup.add(winGroup);

      // Slanted Volumetric Light Shafts
      if (sideIdx === 0 || wIdx % 2 === 0) {
        const beamGeo = new THREE.ConeGeometry(3.6, 28, 16, 1, true);
        const beamMesh = new THREE.Mesh(beamGeo, rayMat);
        const dirX = sideIdx === 0 ? 1 : -1;
        beamMesh.position.set(wx + dirX * 7.8, 8.2, wz);
        beamMesh.rotation.z = dirX * 0.68;
        cathedralGroup.add(beamMesh);
      }
    });
  });

  // 8. Carved Dark Oak Choir Stalls & Nave Pews
  [-12.2, 12.2].forEach(cx => {
    const choirStall = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.5, 9.5), darkOakMat);
    choirStall.position.set(cx, -0.1, -13.5);
    choirStall.castShadow = true;
    cathedralGroup.add(choirStall);
  });

  [14.2, 17.4, 20.6, 23.8].forEach(pz => {
    [-9.2, 9.2].forEach(px => {
      const pewGroup = new THREE.Group();
      pewGroup.position.set(px, -0.85, pz);

      const bench = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.55, 1.1), darkOakMat);
      bench.position.y = 0.45;
      bench.castShadow = true;
      bench.receiveShadow = true;
      pewGroup.add(bench);

      const backrest = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.25, 0.22), darkOakMat);
      backrest.position.set(0, 1.05, 0.45);
      backrest.castShadow = true;
      pewGroup.add(backrest);

      [-3.65, 3.65].forEach(ex => {
        const endPost = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.75, 1.25), darkOakMat);
        endPost.position.set(ex, 0.88, 0);
        pewGroup.add(endPost);
        const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), goldAccentMaterial);
        finial.position.set(ex, 1.88, 0);
        pewGroup.add(finial);
      });

      cathedralGroup.add(pewGroup);
    });
  });

  // Votive Candle Stands
  [-14.2, 14.2].forEach((vx, sIdx) => {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 3.2), goldAccentMaterial);
    rack.position.set(vx, -0.3, 0);
    cathedralGroup.add(rack);

    for (let r = -1.1; r <= 1.1; r += 0.55) {
      const votiveFlame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), flameMat);
      votiveFlame.position.set(vx, 0.38, r);
      cathedralGroup.add(votiveFlame);
      candleFlames.push({ mesh: votiveFlame, baseY: 0.38, phase: r * 3 + sIdx });
    }
  });

  // 9. Swinging Brass Thuribles (Incense Burners)
  [[-11.2, -6.2], [11.2, -6.2], [-11.2, 6.2], [11.2, 6.2]].forEach(([tx, tz], idx) => {
    const pivotGroup = new THREE.Group();
    pivotGroup.position.set(tx!, 25.0, tz!);

    const chainLen = 17.5;
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, chainLen, 6),
      goldAccentMaterial
    );
    chain.position.y = -chainLen / 2;
    pivotGroup.add(chain);

    const censerGroup = new THREE.Group();
    censerGroup.position.y = -chainLen;

    const bowl = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 14, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      goldAccentMaterial
    );
    censerGroup.add(bowl);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.055, 8, 18),
      goldAccentMaterial
    );
    rim.rotation.x = Math.PI / 2;
    censerGroup.add(rim);

    const spireLid = new THREE.Mesh(
      new THREE.ConeGeometry(0.44, 0.85, 8),
      goldAccentMaterial
    );
    spireLid.position.y = 0.42;
    censerGroup.add(spireLid);

    const emberGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      flameMat
    );
    emberGlow.position.y = 0.08;
    censerGroup.add(emberGlow);

    pivotGroup.add(censerGroup);
    cathedralGroup.add(pivotGroup);

    swingingThuribles.push({
      group: pivotGroup,
      speed: 1.15 + (idx % 2) * 0.22,
      phase: idx * 1.57,
      ampX: 0.088,
      ampZ: 0.045
    });
  });

  scene.add(cathedralGroup);

  return {
    cathedralGroup,
    swingingThuribles,
    candleFlames
  };
}
