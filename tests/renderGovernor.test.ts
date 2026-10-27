import { describe, expect, it } from 'bun:test';
import {
  buildRenderGovernorConfig,
  DEFAULT_RENDER_GOVERNOR_CONFIG,
  RenderGovernor,
  RenderPowerStateEnum
} from '../src/graphics/renderGovernor';

describe('RenderGovernor - Battery & GPU Power Conservation', () => {
  it('constructs frozen immutable configuration with defaults and overrides', () => {
    const def = buildRenderGovernorConfig();
    expect(Object.isFrozen(def)).toBe(true);
    expect(def.activeFrameIntervalMs).toBe(DEFAULT_RENDER_GOVERNOR_CONFIG.activeFrameIntervalMs);
    expect(def.idleFrameIntervalMs).toBe(DEFAULT_RENDER_GOVERNOR_CONFIG.idleFrameIntervalMs);

    const custom = buildRenderGovernorConfig({ idleTimeoutMs: 5000 });
    expect(Object.isFrozen(custom)).toBe(true);
    expect(custom.idleTimeoutMs).toBe(5000);
    expect(custom.activeFrameIntervalMs).toBe(16.0);
  });

  it('suspends WebGL rendering completely (0% GPU) when document is hidden or covered by full-screen modal', () => {
    const governor = new RenderGovernor(undefined, 1000);

    const hiddenDecision = governor.evaluateFrame({
      nowMs: 1020,
      isDocumentHidden: true,
      isCoveredByFullScreenModal: false,
      hasActiveCombatOrMotion: true
    });
    expect(hiddenDecision.powerState).toBe(RenderPowerStateEnum.Suspended);
    expect(hiddenDecision.shouldRenderWebGL).toBe(false);
    expect(hiddenDecision.shouldUpdateShadows).toBe(false);
    expect(hiddenDecision.shouldUpdateParticles).toBe(false);
    expect(governor.getPowerState()).toBe(RenderPowerStateEnum.Suspended);

    const modalDecision = governor.evaluateFrame({
      nowMs: 1040,
      isDocumentHidden: false,
      isCoveredByFullScreenModal: true,
      hasActiveCombatOrMotion: false
    });
    expect(modalDecision.powerState).toBe(RenderPowerStateEnum.Suspended);
    expect(modalDecision.shouldRenderWebGL).toBe(false);
  });

  it('throttles active 60fps frames and caches shadow maps until invalidated or motion occurs', () => {
    const governor = new RenderGovernor(
      { activeFrameIntervalMs: 16, idleFrameIntervalMs: 50, idleTimeoutMs: 3000 },
      0
    );

    expect(governor.isShadowMapDirty()).toBe(true);

    // First frame renders and consumes initial shadowMapDirty flag
    const first = governor.evaluateFrame({
      nowMs: 20,
      isDocumentHidden: false,
      isCoveredByFullScreenModal: false,
      hasActiveCombatOrMotion: false
    });
    expect(first.powerState).toBe(RenderPowerStateEnum.Active60Fps);
    expect(first.shouldRenderWebGL).toBe(true);
    expect(first.shouldUpdateShadows).toBe(true);
    expect(governor.isShadowMapDirty()).toBe(false);

    // Frame arriving 8ms later (< 16ms 60fps interval) is skipped to prevent 120Hz battery drain
    const tooSoon = governor.evaluateFrame({
      nowMs: 28,
      isDocumentHidden: false,
      isCoveredByFullScreenModal: false,
      hasActiveCombatOrMotion: false
    });
    expect(tooSoon.shouldRenderWebGL).toBe(false);

    // Frame arriving at 40ms renders WebGL, but reuses cached shadow map
    const second = governor.evaluateFrame({
      nowMs: 40,
      isDocumentHidden: false,
      isCoveredByFullScreenModal: false,
      hasActiveCombatOrMotion: false
    });
    expect(second.shouldRenderWebGL).toBe(true);
    expect(second.shouldUpdateShadows).toBe(false);

    // Explicit shadow invalidation
    governor.invalidateShadowMap();
    expect(governor.isShadowMapDirty()).toBe(true);
    const third = governor.evaluateFrame({
      nowMs: 60,
      isDocumentHidden: false,
      isCoveredByFullScreenModal: false,
      hasActiveCombatOrMotion: false
    });
    expect(third.shouldUpdateShadows).toBe(true);
  });

  it('transitions smoothly to 20fps ambient-idle after idleTimeoutMs and wakes on interaction', () => {
    const governor = new RenderGovernor(
      { activeFrameIntervalMs: 16, idleFrameIntervalMs: 50, idleTimeoutMs: 2000 },
      100
    );

    // At 2500ms (2400ms since last interaction > 2000ms timeout), enters AmbientIdle
    const idleFrame1 = governor.evaluateFrame({
      nowMs: 2500,
      isDocumentHidden: false,
      isCoveredByFullScreenModal: false,
      hasActiveCombatOrMotion: false
    });
    expect(idleFrame1.powerState).toBe(RenderPowerStateEnum.AmbientIdle);
    expect(idleFrame1.shouldRenderWebGL).toBe(true);

    // 25ms later (< 50ms ambient-idle interval), skips WebGL render
    const idleSkipped = governor.evaluateFrame({
      nowMs: 2525,
      isDocumentHidden: false,
      isCoveredByFullScreenModal: false,
      hasActiveCombatOrMotion: false
    });
    expect(idleSkipped.powerState).toBe(RenderPowerStateEnum.AmbientIdle);
    expect(idleSkipped.shouldRenderWebGL).toBe(false);

    // User pointer/key interaction wakes back to Active60Fps
    governor.recordInteraction(2530, true);
    const wokenFrame = governor.evaluateFrame({
      nowMs: 2550,
      isDocumentHidden: false,
      isCoveredByFullScreenModal: false,
      hasActiveCombatOrMotion: false
    });
    expect(wokenFrame.powerState).toBe(RenderPowerStateEnum.Active60Fps);
    expect(wokenFrame.shouldRenderWebGL).toBe(true);
    expect(wokenFrame.shouldUpdateShadows).toBe(true);
  });
});
