import { ImmutableBuilder, match } from '../utils/fp';

export enum RenderPowerStateEnum {
  Suspended = 'suspended',
  AmbientIdle = 'ambient-idle',
  Active60Fps = 'active-60fps'
}

export interface RenderGovernorConfig {
  readonly activeFrameIntervalMs: number;
  readonly idleFrameIntervalMs: number;
  readonly idleTimeoutMs: number;
}

export interface RenderFrameInput {
  readonly nowMs: number;
  readonly isDocumentHidden: boolean;
  readonly isCoveredByFullScreenModal: boolean;
  readonly hasActiveCombatOrMotion: boolean;
}

export interface RenderFrameDecision {
  readonly powerState: RenderPowerStateEnum;
  readonly shouldRenderWebGL: boolean;
  readonly shouldUpdateShadows: boolean;
  readonly shouldUpdateParticles: boolean;
  readonly deltaSeconds: number;
}

export const DEFAULT_RENDER_GOVERNOR_CONFIG: Readonly<RenderGovernorConfig> =
  ImmutableBuilder.from<RenderGovernorConfig>({
    activeFrameIntervalMs: 16.0, // ~60 FPS cap (prevents 120Hz ProMotion from doubling GPU drain)
    idleFrameIntervalMs: 50.0,   // 20 FPS ambient sanctuary candle/dust drift when idle
    idleTimeoutMs: 3500          // Enter ambient-idle 3.5s after last interaction or move
  }).build();

export function buildRenderGovernorConfig(overrides?: Readonly<Partial<RenderGovernorConfig>>): Readonly<RenderGovernorConfig> {
  const builder = ImmutableBuilder.from(DEFAULT_RENDER_GOVERNOR_CONFIG);
  return overrides ? builder.withOverrides(overrides).build() : builder.build();
}

/**
 * Battery & GPU Power Governor for the 3D WebGL Basilica Renderer.
 * - Completely suspends 3D WebGL rendering (0% GPU usage) when the browser tab is hidden
 *   or when any full-screen 2D Arcade Game Theater modal covers the viewport.
 * - Throttles WebGL from 60 FPS down to 20 FPS ambient-idle after 3.5 seconds of inactivity.
 * - Caches the 2048x2048 PCFSoftShadowMap pass (`renderer.shadowMap.autoUpdate = false`)
 *   and only triggers shadow map regeneration when pieces move, shatter, or change theme.
 */
export class RenderGovernor {
  public readonly config: Readonly<RenderGovernorConfig>;
  private lastInteractionMs: number;
  private lastRenderMs: number;
  private shadowMapDirty: boolean = true;
  private currentPowerState: RenderPowerStateEnum = RenderPowerStateEnum.Active60Fps;

  constructor(config?: Readonly<Partial<RenderGovernorConfig>>,
              initialTimeMs: number = 0) {
    this.config = buildRenderGovernorConfig(config);
    this.lastInteractionMs = initialTimeMs;
    this.lastRenderMs = initialTimeMs;
  }

  public recordInteraction(nowMs: number,
                           invalidateShadows: boolean = false): void {
    this.lastInteractionMs = nowMs;
    if (invalidateShadows) {
      this.shadowMapDirty = true;
    }
  }

  public invalidateShadowMap(): void {
    this.shadowMapDirty = true;
  }

  public getPowerState(): RenderPowerStateEnum {
    return this.currentPowerState;
  }

  public isShadowMapDirty(): boolean {
    return this.shadowMapDirty;
  }

  public evaluateFrame(input: Readonly<RenderFrameInput>): Readonly<RenderFrameDecision> {
    if (input.isDocumentHidden || input.isCoveredByFullScreenModal) {
      this.currentPowerState = RenderPowerStateEnum.Suspended;
      this.lastRenderMs = input.nowMs;
      return ImmutableBuilder.from<RenderFrameDecision>({
        powerState: RenderPowerStateEnum.Suspended,
        shouldRenderWebGL: false,
        shouldUpdateShadows: false,
        shouldUpdateParticles: false,
        deltaSeconds: 0
      }).build();
    }

    const isActive =
      input.hasActiveCombatOrMotion ||
      input.nowMs - this.lastInteractionMs <= this.config.idleTimeoutMs;

    this.currentPowerState = isActive
      ? RenderPowerStateEnum.Active60Fps
      : RenderPowerStateEnum.AmbientIdle;

    const targetIntervalMs = match(this.currentPowerState as RenderPowerStateEnum, {
      [RenderPowerStateEnum.Suspended]: () => Infinity,
      [RenderPowerStateEnum.AmbientIdle]: () => this.config.idleFrameIntervalMs,
      [RenderPowerStateEnum.Active60Fps]: () => this.config.activeFrameIntervalMs
    });

    const elapsedMs = Math.max(0, input.nowMs - this.lastRenderMs);
    if (this.lastRenderMs > 0 && elapsedMs < targetIntervalMs) {
      return ImmutableBuilder.from<RenderFrameDecision>({
        powerState: this.currentPowerState,
        shouldRenderWebGL: false,
        shouldUpdateShadows: false,
        shouldUpdateParticles: false,
        deltaSeconds: 0
      }).build();
    }

    const deltaSeconds = this.lastRenderMs === 0 ? 0.016 : Math.min(elapsedMs / 1000, 0.05);
    this.lastRenderMs = input.nowMs;

    const shouldUpdateShadows = this.shadowMapDirty || input.hasActiveCombatOrMotion;
    if (shouldUpdateShadows) {
      this.shadowMapDirty = false;
    }

    return ImmutableBuilder.from<RenderFrameDecision>({
      powerState: this.currentPowerState,
      shouldRenderWebGL: true,
      shouldUpdateShadows,
      shouldUpdateParticles: true,
      deltaSeconds
    }).build();
  }
}
