# 🏛️ Scene & Background Environments Roadmap

This document outlines the architectural specification and implementation roadmap for introducing modular, swappable 3D environments to **Wizard's Chess 3D & Sanctuary Arcade**.

---

## 🎨 Design Philosophy & Guardrails
- **Core Theme Primacy**: The **High Gothic Basilica / Sanctuary** remains the flagship default environment (ribbed vaulting, rose stained-glass windows, stone columns, organ acoustics).
- **Zero Static Assets**: All new scenes must be synthesized procedurally in Three.js (procedural geometry, PBR canvas-generated textures, custom shaders, and Web Audio acoustic resonance).
- **Device Tier Scalability**: Every environment must support tier degradation (Mobile Lite vs Desktop PBR).

---

## 🗺️ Planned 3D Scene Environments

### 1. High Gothic Basilica / Sanctuary *(Active Default)*
- **Visuals**: Ribbed Gothic quadripartite vaulting, stone pointed arches, rose stained-glass window casting colored caustic light on board, flying buttresses, altar candlelight.
- **Audio Profile**: Harmonic cathedral pipe organ chords, stone friction tile slide, reverberant bell tolls.

### 2. High Court of Justice / The Grand Courtroom *(Phase 6)*
- **Theme**: Grand Victorian / Gothic English jurisprudence hall.
- **Visuals**:
  - Dark polished mahogany judicial bench and wood-paneled walls.
  - Scales of Justice brass sculpture overhead with directional spotlight.
  - Balustrades, jury benches, and towering brass chandeliers with volumetric light shafts.
  - Green velvet felt inserts and bronze rail accents.
- **Audio Profile**:
  - Walnut gavel strike upon decisive moves/captures.
  - Subtle room reverberation of parchment turning and low murmur.
  - Brass timepiece / pendulum clock ticking during timed matches.

### 3. Royal Palace / Imperial Throne Room *(Phase 7)*
- **Theme**: Grand Baroque Imperial Palace.
- **Visuals**:
  - Polished white Carrara marble floors with inlaid gold filigree borders.
  - Crimson velvet damask drapery hung between Corinthian gilded columns.
  - High gilded ornate ceilings with crystal prism chandeliers.
  - Elevated twin thrones flanked by standard banners bearing heraldic sigils.
- **Audio Profile**:
  - Regal brass trumpet fanfare on checkmate and natural 21.
  - Cello and harpsichord chamber accompaniment.
  - Polished marble resonance with crisp crystal reflections.

### 4. Grand Monastic Library / Ancient Scriptorium *(Phase 8)*
- **Theme**: Towering multi-tier scholastic library.
- **Visuals**:
  - Floor-to-ceiling spiral bookstacks filled with procedural leather and vellum tomes.
  - Brass astrolabes, armillary spheres, and celestial globes suspended on chains.
  - Stained-glass reading clerestory windows.
  - Flickering amber candle clusters on dark oak reading desks.
- **Audio Profile**:
  - Soft acoustic resonance, whisper of dust motes, crackle of beeswax candles, distant rain on stained glass.

### 5. Alchemical Crucible / Arcane Laboratory *(Phase 9)*
- **Theme**: Mystical philosopher-alchemist subterranean vault.
- **Visuals**:
  - Dark basalt stone walls engraved with glowing cyan and gold alchemical transmutation circles.
  - Procedural glass alembics, retorts, and bubbling flasks with luminous bioluminescent fluids.
  - Central transmutation furnace casting warm flickering orange under-glow.
- **Audio Profile**:
  - Low resonant crystal hum, bubbling liquid harmonics, arcane resonance on piece capture.

---

## 🔧 Architecture & Modular Scene Provider Pattern

```typescript
export interface SceneEnvironmentConfig {
  id: string;
  name: string;
  ambientLightColor: number;
  ambientIntensity: number;
  dirLightColor: number;
  dirLightIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  acousticsProfile: 'cathedral' | 'courtroom' | 'palace' | 'library' | 'crucible';
}

export interface ISceneEnvironmentProvider {
  buildEnvironment(scene: THREE.Scene, deviceTier: DeviceTierEnum): void;
  disposeEnvironment(scene: THREE.Scene): void;
}
```
