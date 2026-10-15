import * as THREE from 'three';
import type { PieceColor, PieceMeshGroup, PieceType } from '../types';
import type { AppMaterials } from './materials';

export function buildWizardPieceMesh(
  type: PieceType,
  color: PieceColor,
  materials: AppMaterials
): PieceMeshGroup {
  const root = new THREE.Group() as PieceMeshGroup;
  const bodyGroup = new THREE.Group();
  const weaponGroup = new THREE.Group();

  const mainMat = color === 'w' ? materials.whitePieceMaterial : materials.blackPieceMaterial;
  const trimMat = color === 'w' ? materials.goldAccentMaterial : materials.arcaneAccentMaterial;
  const steelBladeMaterial = materials.steelBladeMaterial;

  // Pedestal Base with Consecrated Trim Ring
  const basePedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.68, 0.80, 0.34, 20),
    mainMat
  );
  basePedestal.position.y = 0.17;
  basePedestal.castShadow = true;
  basePedestal.receiveShadow = true;
  root.add(basePedestal);

  const trimRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.70, 0.055, 10, 24),
    trimMat
  );
  trimRing.rotation.x = Math.PI / 2;
  trimRing.position.y = 0.33;
  root.add(trimRing);

  if (type === 'p') {
    // PAWN: Armored Swiss Guard Sentinel with Halberd
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.54, 1.08, 16), mainMat);
    torso.position.y = 0.88;
    torso.castShadow = true;
    bodyGroup.add(torso);

    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 14), mainMat);
    helm.position.y = 1.62;
    helm.castShadow = true;
    bodyGroup.add(helm);

    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.38, 8), trimMat);
    crest.position.y = 1.98;
    bodyGroup.add(crest);

    // Halberd in Right Hand
    weaponGroup.position.set(0.45, 1.05, 0.15);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.2, 8), trimMat);
    shaft.position.y = 0.35;
    weaponGroup.add(shaft);

    const axeBlade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.52, 4), steelBladeMaterial);
    axeBlade.rotation.z = Math.PI / 2;
    axeBlade.position.set(0, 1.22, 0.14);
    weaponGroup.add(axeBlade);

  } else if (type === 'r') {
    // ROOK: Castellated Basilica Battlement Tower with Warhammer
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.65, 1.65, 12), mainMat);
    tower.position.y = 1.15;
    tower.castShadow = true;
    bodyGroup.add(tower);

    const crownRim = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.56, 0.34, 12), trimMat);
    crownRim.position.y = 2.08;
    bodyGroup.add(crownRim);

    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.22), mainMat);
      merlon.position.set(Math.cos(a) * 0.48, 2.34, Math.sin(a) * 0.48);
      bodyGroup.add(merlon);
    }

    weaponGroup.position.set(0.58, 1.35, 0.15);
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.95, 8), trimMat);
    haft.position.y = 0.25;
    weaponGroup.add(haft);
    const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.72), steelBladeMaterial);
    hammerHead.position.set(0, 1.18, 0.08);
    weaponGroup.add(hammerHead);

  } else if (type === 'n') {
    // KNIGHT: Armored Warhorse Destrier with Jousting Lance
    const lowerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.62, 1.15, 14), mainMat);
    lowerBody.position.y = 0.90;
    lowerBody.castShadow = true;
    bodyGroup.add(lowerBody);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.95, 0.62), mainMat);
    neck.position.set(0, 1.68, 0.08);
    neck.rotation.x = 0.28;
    neck.castShadow = true;
    bodyGroup.add(neck);

    const muzzle = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.72, 8), trimMat);
    muzzle.rotation.x = Math.PI / 2 + 0.25;
    muzzle.position.set(0, 1.96, 0.46);
    bodyGroup.add(muzzle);

    weaponGroup.position.set(0.54, 1.35, 0.15);
    const lance = new THREE.Mesh(new THREE.ConeGeometry(0.09, 2.65, 10), steelBladeMaterial);
    lance.rotation.x = Math.PI / 3.2;
    lance.position.set(0, 0.35, 0.55);
    weaponGroup.add(lance);

  } else if (type === 'b') {
    // BISHOP: Mitred Cathedral Prelate with Golden Crosier Staff
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.60, 1.68, 18), mainMat);
    robe.position.y = 1.16;
    robe.castShadow = true;
    bodyGroup.add(robe);

    const stole = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.06, 8, 20), trimMat);
    stole.rotation.x = Math.PI / 2;
    stole.position.y = 1.85;
    bodyGroup.add(stole);

    // Split Gothic Mitre Hat
    const mitre = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.78, 12), mainMat);
    mitre.position.y = 2.32;
    bodyGroup.add(mitre);

    const mitreCross = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), trimMat);
    mitreCross.position.y = 2.76;
    bodyGroup.add(mitreCross);

    // Golden Crosier Shepherd Staff
    weaponGroup.position.set(0.50, 1.25, 0.15);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.45, 8), trimMat);
    staff.position.y = 0.45;
    weaponGroup.add(staff);

    const crook = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 18, Math.PI * 1.5), trimMat);
    crook.position.set(0, 1.72, 0.08);
    crook.rotation.y = Math.PI / 2;
    weaponGroup.add(crook);

  } else if (type === 'q') {
    // QUEEN: Crowned Basilica Sovereign with Star Scepter
    const gown = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.66, 1.98, 20), mainMat);
    gown.position.y = 1.32;
    gown.castShadow = true;
    bodyGroup.add(gown);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.065, 10, 24), trimMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 2.28;
    bodyGroup.add(collar);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), mainMat);
    head.position.y = 2.55;
    bodyGroup.add(head);

    const coronet = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.28, 0.30, 12), trimMat);
    coronet.position.y = 2.86;
    bodyGroup.add(coronet);

    weaponGroup.position.set(0.54, 1.48, 0.18);
    const scepterRod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.35, 8), trimMat);
    scepterRod.position.y = 0.42;
    weaponGroup.add(scepterRod);

    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 1), trimMat);
    orb.position.set(0, 1.65, 0);
    weaponGroup.add(orb);

  } else if (type === 'k') {
    // KING: Cathedral-Crowned Monarch with Royal Broadsword
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.70, 2.15, 16), mainMat);
    mantle.position.y = 1.40;
    mantle.castShadow = true;
    bodyGroup.add(mantle);

    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.28, 0.66), trimMat);
    shoulders.position.y = 2.35;
    bodyGroup.add(shoulders);

    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.42, 10), trimMat);
    crown.position.y = 2.75;
    bodyGroup.add(crown);

    // Cathedral Cross Finial atop King's Crown
    const kCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.45, 0.11), trimMat);
    kCrossV.position.y = 3.16;
    bodyGroup.add(kCrossV);
    const kCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.11), trimMat);
    kCrossH.position.y = 3.22;
    bodyGroup.add(kCrossH);

    // Royal Broadsword
    weaponGroup.position.set(0.60, 1.52, 0.22);
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.09, 0.14), trimMat);
    hilt.position.y = 0.35;
    weaponGroup.add(hilt);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.95, 0.05), steelBladeMaterial);
    blade.position.y = 1.32;
    weaponGroup.add(blade);
  }

  bodyGroup.add(weaponGroup);
  root.add(bodyGroup);

  // Face White North (-Z) and Black South (+Z)
  const baseRotY = color === 'w' ? Math.PI : 0;
  root.rotation.y = baseRotY;

  root.userData = {
    type,
    color,
    baseRotY,
    bodyGroup,
    weaponGroup,
    idlePhase: Math.random() * Math.PI * 2
  };

  return root;
}
