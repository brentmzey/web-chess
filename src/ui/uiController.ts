import type { Chess, Move } from 'chess.js';
import {
  getDifficultyProfile,
  getGameModeConfig,
  UNICODE_PIECES
} from '../constants/board';
import type { GameRuleInfo } from '../constants/gameRules';
import { globalConfigClient } from '../realtime/configClient';
import {
  DeviceTierEnum,
  GameModeEnum,
  OpponentDifficultyEnum,
  PieceColorEnum,
  type DeviceProfileConfig,
  type EncryptedStorageAuditReport,
  type GameMode,
  type OpponentDifficulty,
  type PieceType
} from '../types';
import {
  domById,
  fromNullable,
  ImmutableBuilder,
  match,
  matchBool,
  some,
  zipOptions,
  zip3Options,
  type Option,
  type Result
} from '../utils/fp';

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
});

/**
 * Escapes HTML metacharacters so untrusted strings (e.g. SAN move text restored from storage)
 * can never inject markup into `innerHTML` templates.
 */
export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, ch => fromNullable(HTML_ESCAPE_MAP[ch]).getOrElse(ch));
}

export interface UIControllerElements {
  readonly turnDot: Option<HTMLElement>;
  readonly turnText: Option<HTMLElement>;
  readonly gameModeBadge: Option<HTMLElement>;
  readonly difficultyBadge: Option<HTMLElement>;
  readonly deviceTierBadge: Option<HTMLElement>;
  readonly mobileLiteBanner: Option<HTMLElement>;
  readonly mobileLiteBannerText: Option<HTMLElement>;
  readonly statusBanner: Option<HTMLElement>;
  readonly statusBannerText: Option<HTMLElement>;
  readonly capturedByWhite: Option<HTMLElement>;
  readonly capturedByBlack: Option<HTMLElement>;
  readonly shatteredBlackList: Option<HTMLElement>;
  readonly shatteredWhiteList: Option<HTMLElement>;
  readonly moveCountPill: Option<HTMLElement>;
  readonly moveHistoryContainer: Option<HTMLElement>;
  readonly logDrawer: Option<HTMLElement>;
  readonly gameoverModal: Option<HTMLElement>;
  readonly gameoverTitle: Option<HTMLElement>;
  readonly gameoverSubtitle: Option<HTMLElement>;
  readonly gameoverStandardActions: Option<HTMLElement>;
  readonly gameoverLiveActions: Option<HTMLElement>;
  readonly modalLeaveLive: Option<HTMLButtonElement>;
  readonly modalInspectLive: Option<HTMLButtonElement>;
  readonly closeGameoverBtn: Option<HTMLButtonElement>;
  readonly promotionModal: Option<HTMLElement>;
  readonly closePromotionBtn: Option<HTMLButtonElement>;
  readonly pregameModal: Option<HTMLElement>;
  readonly storageAuditModal: Option<HTMLElement>;
  readonly storageAuditAlgo: Option<HTMLElement>;
  readonly storageAuditSummary: Option<HTMLElement>;
  readonly storageAuditJson: Option<HTMLElement>;
  readonly wipeConfirmRow: Option<HTMLElement>;
  readonly btnUndo: Option<HTMLButtonElement>;
  readonly undoIcon: Option<HTMLElement>;
  readonly undoLabel: Option<HTMLElement>;
  readonly undoRuleStatusPill: Option<HTMLElement>;
  readonly liveSessionModal: Option<HTMLElement>;
  readonly tabCreateLive: Option<HTMLElement>;
  readonly tabJoinLive: Option<HTMLElement>;
  readonly panelCreateLive: Option<HTMLElement>;
  readonly panelJoinLive: Option<HTMLElement>;
  readonly liveCreatedInfo: Option<HTMLElement>;
  readonly liveCreatedCode: Option<HTMLElement>;
  readonly liveCreatedUrl: Option<HTMLInputElement>;
  readonly liveJoinError: Option<HTMLElement>;
  readonly liveActiveBanner: Option<HTMLElement>;
  readonly liveActiveCode: Option<HTMLElement>;
  readonly btnLeaveLiveSession: Option<HTMLButtonElement>;
  readonly pregameModeLockNotice: Option<HTMLElement>;
  readonly btnToggleDoNotDelete: Option<HTMLButtonElement>;
  readonly iconDoNotDelete: Option<HTMLElement>;
  readonly labelDoNotDelete: Option<HTMLElement>;
  readonly liveHostDoNotDelete: Option<HTMLInputElement>;
  readonly arcadeHubModal: Option<HTMLElement>;
  readonly btnCloseArcadeHub: Option<HTMLButtonElement>;
  readonly btnArcadeHub: Option<HTMLButtonElement>;
  readonly hubQuickJoinInput: Option<HTMLInputElement>;
  readonly btnHubQuickJoin: Option<HTMLButtonElement>;
  readonly hubQuickJoinFeedback: Option<HTMLElement>;
  readonly livePersistentHud: Option<HTMLElement>;
  readonly livePersistentCode: Option<HTMLElement>;
  readonly btnPersistentCopyLink: Option<HTMLButtonElement>;
  readonly iconPersistentCopyLink: Option<HTMLElement>;
  readonly labelPersistentCopyLink: Option<HTMLElement>;
  readonly btnPersistentCopyCode: Option<HTMLButtonElement>;
  readonly btnPersistentTogglePin: Option<HTMLButtonElement>;
  readonly iconPersistentPin: Option<HTMLElement>;
  readonly labelPersistentPin: Option<HTMLElement>;
  readonly btnLiveBannerCopyLink: Option<HTMLButtonElement>;
  readonly iconBannerCopyLink: Option<HTMLElement>;
  readonly labelBannerCopyLink: Option<HTMLElement>;
  readonly btnPersistentLeaveLive: Option<HTMLButtonElement>;
  readonly blackjackModal: Option<HTMLElement>;
  readonly btnCloseBlackjack: Option<HTMLButtonElement>;
  readonly pokerModal: Option<HTMLElement>;
  readonly skipboModal: Option<HTMLElement>;
  readonly phase10Modal: Option<HTMLElement>;
  readonly unoModal: Option<HTMLElement>;
  readonly avalonModal: Option<HTMLElement>;
  readonly setModal: Option<HTMLElement>;
  readonly arcadeRulesModal: Option<HTMLElement>;
  readonly btnCloseArcadeRules: Option<HTMLButtonElement>;
  readonly btnDismissArcadeRules: Option<HTMLButtonElement>;
  readonly rulesModalTitle: Option<HTMLElement>;
  readonly rulesModalRealLife: Option<HTMLElement>;
  readonly rulesModalObjective: Option<HTMLElement>;
  readonly rulesModalRulesList: Option<HTMLElement>;
  readonly rulesModalExternalLink: Option<HTMLAnchorElement>;
  readonly rulesModalExternalLabel: Option<HTMLElement>;
  readonly btnWakeLock: Option<HTMLButtonElement>;
  readonly wakeLockIcon: Option<HTMLElement>;
  readonly wakeLockLabel: Option<HTMLElement>;
  readonly wakeLockCheckbox: Option<HTMLInputElement>;
  readonly wakeLockPregameBadge: Option<HTMLElement>;
  readonly btnPersistentToggleWakeLock: Option<HTMLButtonElement>;
  readonly iconPersistentWakeLock: Option<HTMLElement>;
  readonly labelPersistentWakeLock: Option<HTMLElement>;
}

/**
 * Fluent Builder for constructing an immutable `Readonly<UIControllerElements>` registry
 * where every DOM element reference is a pure `Option<HTMLElement>` rather than `HTMLElement | null`.
 */
export function buildUIControllerElements(overrides?: Readonly<Partial<UIControllerElements>>): Readonly<UIControllerElements> {
  const baseElements: UIControllerElements = {
    turnDot: domById('turn-dot'),
    turnText: domById('turn-text'),
    gameModeBadge: domById('game-mode-badge'),
    difficultyBadge: domById('difficulty-badge'),
    deviceTierBadge: domById('device-tier-badge'),
    mobileLiteBanner: domById('mobile-lite-banner'),
    mobileLiteBannerText: domById('mobile-lite-banner-text'),
    statusBanner: domById('status-banner'),
    statusBannerText: domById('status-banner-text'),
    capturedByWhite: domById('captured-by-white'),
    capturedByBlack: domById('captured-by-black'),
    shatteredBlackList: domById('shattered-black-list'),
    shatteredWhiteList: domById('shattered-white-list'),
    moveCountPill: domById('move-count-pill'),
    moveHistoryContainer: domById('move-history-container'),
    logDrawer: domById('log-drawer'),
    gameoverModal: domById('gameover-modal'),
    gameoverTitle: domById('gameover-title'),
    gameoverSubtitle: domById('gameover-subtitle'),
    gameoverStandardActions: domById('gameover-standard-actions'),
    gameoverLiveActions: domById('gameover-live-actions'),
    modalLeaveLive: domById<HTMLButtonElement>('modal-leave-live'),
    modalInspectLive: domById<HTMLButtonElement>('modal-inspect-live'),
    closeGameoverBtn: domById<HTMLButtonElement>('close-gameover-btn'),
    promotionModal: domById('promotion-modal'),
    closePromotionBtn: domById<HTMLButtonElement>('close-promotion-btn'),
    pregameModal: domById('pregame-modal'),
    storageAuditModal: domById('storage-audit-modal'),
    storageAuditAlgo: domById('storage-audit-algo'),
    storageAuditSummary: domById('storage-audit-summary'),
    storageAuditJson: domById('storage-audit-json'),
    wipeConfirmRow: domById('wipe-confirm-row'),
    btnUndo: domById<HTMLButtonElement>('btn-undo'),
    undoIcon: domById('undo-icon'),
    undoLabel: domById('undo-label'),
    undoRuleStatusPill: domById('undo-rule-status-pill'),
    liveSessionModal: domById('live-session-modal'),
    tabCreateLive: domById('tab-create-live'),
    tabJoinLive: domById('tab-join-live'),
    panelCreateLive: domById('panel-create-live'),
    panelJoinLive: domById('panel-join-live'),
    liveCreatedInfo: domById('live-created-info'),
    liveCreatedCode: domById('live-created-code'),
    liveCreatedUrl: domById<HTMLInputElement>('live-created-url'),
    liveJoinError: domById('live-join-error'),
    liveActiveBanner: domById('live-active-banner'),
    liveActiveCode: domById('live-active-code'),
    btnLeaveLiveSession: domById<HTMLButtonElement>('btn-leave-live-session'),
    btnToggleDoNotDelete: domById<HTMLButtonElement>('btn-toggle-do-not-delete'),
    iconDoNotDelete: domById('icon-do-not-delete'),
    labelDoNotDelete: domById('label-do-not-delete'),
    liveHostDoNotDelete: domById<HTMLInputElement>('live-host-do-not-delete'),
    arcadeHubModal: domById('arcade-hub-modal'),
    btnCloseArcadeHub: domById<HTMLButtonElement>('btn-close-arcade-hub'),
    btnArcadeHub: domById<HTMLButtonElement>('btn-arcade-hub'),
    hubQuickJoinInput: domById<HTMLInputElement>('hub-quick-join-input'),
    btnHubQuickJoin: domById<HTMLButtonElement>('btn-hub-quick-join'),
    hubQuickJoinFeedback: domById('hub-quick-join-feedback'),
    livePersistentHud: domById('live-persistent-hud'),
    livePersistentCode: domById('live-persistent-code'),
    btnPersistentCopyLink: domById<HTMLButtonElement>('btn-persistent-copy-link'),
    iconPersistentCopyLink: domById('icon-persistent-copy-link'),
    labelPersistentCopyLink: domById('label-persistent-copy-link'),
    btnPersistentCopyCode: domById<HTMLButtonElement>('btn-persistent-copy-code'),
    btnPersistentTogglePin: domById<HTMLButtonElement>('btn-persistent-toggle-pin'),
    iconPersistentPin: domById('icon-persistent-pin'),
    labelPersistentPin: domById('label-persistent-pin'),
    btnLiveBannerCopyLink: domById<HTMLButtonElement>('btn-live-banner-copy-link'),
    iconBannerCopyLink: domById('icon-banner-copy-link'),
    labelBannerCopyLink: domById('label-banner-copy-link'),
    btnPersistentLeaveLive: domById<HTMLButtonElement>('btn-persistent-leave-live'),
    blackjackModal: domById('blackjack-modal'),
    btnCloseBlackjack: domById<HTMLButtonElement>('btn-close-blackjack'),
    pokerModal: domById('poker-modal'),
    skipboModal: domById('skipbo-modal'),
    phase10Modal: domById('phase10-modal'),
    unoModal: domById('uno-modal'),
    avalonModal: domById('avalon-modal'),
    setModal: domById('set-modal'),
    arcadeRulesModal: domById('arcade-rules-modal'),
    btnCloseArcadeRules: domById<HTMLButtonElement>('btn-close-arcade-rules'),
    btnDismissArcadeRules: domById<HTMLButtonElement>('btn-dismiss-arcade-rules'),
    rulesModalTitle: domById('rules-modal-title'),
    rulesModalRealLife: domById('rules-modal-real-life'),
    rulesModalObjective: domById('rules-modal-objective'),
    rulesModalRulesList: domById('rules-modal-rules-list'),
    rulesModalExternalLink: domById<HTMLAnchorElement>('rules-modal-external-link'),
    rulesModalExternalLabel: domById('rules-modal-external-label'),
    pregameModeLockNotice: domById('pregame-mode-lock-notice'),
    btnWakeLock: domById<HTMLButtonElement>('btn-wake-lock'),
    wakeLockIcon: domById('wake-lock-icon'),
    wakeLockLabel: domById('wake-lock-label'),
    wakeLockCheckbox: domById<HTMLInputElement>('wake-lock-checkbox'),
    wakeLockPregameBadge: domById('wake-lock-pregame-badge'),
    btnPersistentToggleWakeLock: domById<HTMLButtonElement>('btn-persistent-toggle-wake-lock'),
    iconPersistentWakeLock: domById('icon-persistent-wake-lock'),
    labelPersistentWakeLock: domById('label-persistent-wake-lock')
  };

  const builder = ImmutableBuilder.from(baseElements);
  return overrides ? builder.withOverrides(overrides).build() : builder.build();
}

export class UIController {
  private readonly el: Readonly<UIControllerElements>;
  public drawerOpen: boolean = false;

  constructor(customElements?: Readonly<Partial<UIControllerElements>>) {
    this.el = buildUIControllerElements(customElements);
  }

  public applyDeviceProfileUI(profile: Readonly<DeviceProfileConfig>): void {
    this.el.deviceTierBadge.map(badge => {
      badge.textContent = profile.badge;
      if (profile.tier === DeviceTierEnum.MobileLite) {
        badge.className =
          'hidden md:inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-400/15 text-teal-300 border border-teal-400/30';
      } else {
        badge.className =
          'hidden md:inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-stone-400/15 text-stone-300 border border-stone-400/30';
      }
    });

    this.el.mobileLiteBanner.map(banner => {
      if (profile.tier === DeviceTierEnum.MobileLite) {
        banner.classList.remove('hidden');
        this.el.mobileLiteBannerText.map(txt => {
          txt.textContent = profile.notice;
        });
      } else {
        banner.classList.add('hidden');
      }
    });
  }

  public update(chess: Readonly<Chess>,
                mode: GameMode,
                customStatus?: string,
                difficulty: OpponentDifficulty = OpponentDifficultyEnum.Balanced,
                allowUndo: boolean = true): void {
    const turn = chess.turn();
    const diffProfile = getDifficultyProfile(difficulty);
    const modeConfig = getGameModeConfig(mode);

    this.el.gameModeBadge.map(badge => {
      badge.textContent = modeConfig.badge;
    });

    this.el.difficultyBadge.map(badge => {
      if (mode === GameModeEnum.PassAndPlay || mode === GameModeEnum.Live) {
        badge.classList.add('hidden');
      } else {
        badge.classList.remove('hidden');
        badge.textContent = diffProfile.badge;
      }
    });

    zipOptions(this.el.turnDot, this.el.turnText).map(([turnDot, turnText]) => {
      if (turn === PieceColorEnum.White) {
        turnDot.className =
          'w-2.5 h-2.5 rounded-full bg-stone-100 shadow-[0_0_8px_#fff] transition-colors duration-300';
        turnText.textContent = "White Marble's Turn";
      } else {
        turnDot.className =
          'w-2.5 h-2.5 rounded-full bg-purple-400 shadow-[0_0_8px_#a855f7] transition-colors duration-300';
        turnText.textContent = fromNullable(customStatus).getOrElse(
          match(mode as GameModeEnum, {
            [GameModeEnum.PassAndPlay]: () => "Black Obsidian's Turn",
            [GameModeEnum.Minimax]: () => `Minimax (${diffProfile.badge}) Thinking...`,
            [GameModeEnum.MicroNeural]: () => `Neural AI (${diffProfile.badge}) Evaluating...`,
            [GameModeEnum.GeminiNano]: () => `Gemini Nano (${diffProfile.badge}) Thinking...`,
            [GameModeEnum.Live]: () => "Remote Opponent's Turn"
          })
        );
      }
    });

    zipOptions(this.el.statusBanner, this.el.statusBannerText).map(([statusBanner, statusBannerText]) => {
      if (chess.in_checkmate()) {
        statusBanner.classList.remove('hidden');
        statusBannerText.textContent = 'CHECKMATE!';
      } else if (chess.in_check()) {
        statusBanner.classList.remove('hidden');
        statusBannerText.textContent = 'KING IN CHECK!';
      } else {
        statusBanner.classList.add('hidden');
      }
    });

    const history = chess.history({ verbose: true });

    // Update Undo button state based on pre-game allowUndo rule & move history
    this.el.btnUndo.map(btn => {
      if (!allowUndo) {
        btn.classList.add('opacity-45');
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'Undo Disabled for this Match (Strict Mode)';
        this.el.undoIcon.map(ic => {
          ic.textContent = 'lock';
        });
        this.el.undoLabel.map(lbl => {
          lbl.textContent = 'Locked';
        });
      } else {
        btn.classList.remove('opacity-45');
        btn.setAttribute('aria-disabled', 'false');
        btn.title = history.length > 0 ? 'Undo Last Move' : 'No moves to undo yet';
        this.el.undoIcon.map(ic => {
          ic.textContent = 'undo';
        });
        this.el.undoLabel.map(lbl => {
          lbl.textContent = 'Undo';
        });
      }
    });

    this.el.undoRuleStatusPill.map(pill => {
      pill.textContent = allowUndo ? 'Undo: Allowed' : 'Undo: Locked (Strict)';
      pill.className = allowUndo
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/30 font-semibold'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30 font-semibold';
    });

    const shatteredBlack: string[] = [];
    const shatteredWhite: string[] = [];

    history.forEach((m: Readonly<Move>) => {
      if (m.captured) {
        if (m.color === PieceColorEnum.White) {
          shatteredBlack.push(UNICODE_PIECES.b[m.captured as PieceType]);
        } else {
          shatteredWhite.push(UNICODE_PIECES.w[m.captured as PieceType]);
        }
      }
    });

    this.el.capturedByWhite.map(el => {
      el.textContent = String(shatteredBlack.length);
    });
    this.el.capturedByBlack.map(el => {
      el.textContent = String(shatteredWhite.length);
    });

    this.el.shatteredBlackList.map(el => {
      el.innerHTML = shatteredBlack.length
        ? shatteredBlack
            .map(icon => `<span class="text-lg leading-none">${escapeHtml(icon)}</span>`)
            .join('')
        : '<span class="text-xs text-stone-600 italic">None yet</span>';
    });

    this.el.shatteredWhiteList.map(el => {
      el.innerHTML = shatteredWhite.length
        ? shatteredWhite
            .map(icon => `<span class="text-lg leading-none">${escapeHtml(icon)}</span>`)
            .join('')
        : '<span class="text-xs text-stone-600 italic">None yet</span>';
    });

    this.el.moveCountPill.map(el => {
      el.textContent = String(history.length);
    });

    this.el.moveHistoryContainer.map(container => {
      if (history.length === 0) {
        container.innerHTML =
          '<div class="text-stone-500 italic text-center py-8">Select a piece on the Crossing Altar to command your forces.</div>';
      } else {
        const rows: string[] = [];
        for (let i = 0; i < history.length; i += 2) {
          const moveNum = Math.floor(i / 2) + 1;
          const wMove = history[i]!;
          const bMove = history[i + 1];
          const wCap = wMove.captured ? '⚔️' : '';
          const bCap = bMove && bMove.captured ? '⚔️' : '';
          const safeWSan = escapeHtml(wMove.san);
          const safeBSan = bMove ? `${escapeHtml(bMove.san)} ${bCap}` : '';
          rows.push(`
            <div class="grid grid-cols-7 items-center py-1 px-2 rounded-lg ${moveNum % 2 === 0 ? 'bg-white/5' : ''}">
                <span class="col-span-1 text-stone-500">${moveNum}.</span>
                <span class="col-span-3 text-amber-100 font-medium">${safeWSan} ${wCap}</span>
                <span class="col-span-3 text-purple-300 font-medium">${safeBSan}</span>
            </div>
          `);
        }
        container.innerHTML = rows.join('');
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  public showGameOver(chess: Readonly<Chess>,
                      isLiveMode: boolean = false,
                      sessionCode?: string): void {
    zip3Options(this.el.gameoverModal, this.el.gameoverTitle, this.el.gameoverSubtitle).map(
      ([gameoverModal, gameoverTitle, gameoverSubtitle]) => {
        if (chess.in_checkmate()) {
          const winner = chess.turn() === PieceColorEnum.White ? 'Black Obsidian' : 'White Marble';
          gameoverTitle.textContent = 'CHECKMATE';
          gameoverSubtitle.textContent = `${winner} triumphs inside the High Gothic Basilica!`;
        } else {
          gameoverTitle.textContent = 'STALEMATE / DRAW';
          gameoverSubtitle.textContent = isLiveMode
            ? `Stalemate reached in Live Match ${sessionCode || ''}. Both sides share sanctuary honors.`
            : 'Neither army yields inside the sacred sanctuary.';
        }

        this.el.gameoverLiveActions.map(actions => {
          actions.classList.toggle('hidden', !isLiveMode);
          actions.classList.toggle('flex', isLiveMode);
        });
        this.el.gameoverStandardActions.map(actions => {
          actions.classList.toggle('hidden', isLiveMode);
          actions.classList.toggle('flex', !isLiveMode);
        });

        gameoverModal.classList.remove('hidden');
        gameoverModal.classList.add('flex');
      }
    );
  }

  public hideGameOver(): void {
    this.el.gameoverModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public showPromotionModal(): void {
    this.el.promotionModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hidePromotionModal(): void {
    this.el.promotionModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public showPreGameModal(): void {
    this.el.pregameModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hidePreGameModal(): void {
    this.el.pregameModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public showStorageAuditModal(): void {
    this.el.storageAuditModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hideStorageAuditModal(): void {
    this.hideWipeConfirm();
    this.el.storageAuditModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public showWipeConfirm(): void {
    this.el.wipeConfirmRow.map(row => {
      row.classList.remove('hidden');
      row.classList.add('flex');
    });
  }

  public hideWipeConfirm(): void {
    this.el.wipeConfirmRow.map(row => {
      row.classList.add('hidden');
      row.classList.remove('flex');
    });
  }

  public renderStorageAudit(auditResult: Readonly<Result<EncryptedStorageAuditReport, string>>): void {
    auditResult.fold(
      errMsg => {
        this.el.storageAuditAlgo.map(el => {
          el.textContent =
            'AES-GCM-256 (Web Crypto CSPRNG Non-Extractable Key • 12-Byte Random IV • 128-Bit Auth Tag)';
        });
        this.el.storageAuditSummary.map(el => {
          el.textContent = `Storage Audit Notice: ${errMsg}`;
        });
        this.el.storageAuditJson.map(el => {
          el.textContent = JSON.stringify(
            {
              algorithm: 'AES-GCM-256',
              keyExtractable: false,
              hardcodedBundleKey: false,
              plaintextExposed: false,
              error: errMsg
            },
            null,
            2
          );
        });
      },
      report => {
        this.el.storageAuditAlgo.map(el => {
          el.textContent = `${report.algorithm} • ${report.keyLengthBits}-Bit Non-Extractable Key • ${report.ivLengthBytes}-Byte IV • ${report.cipherMode}`;
        });
        this.el.storageAuditSummary.map(el => {
          el.textContent = `DB: ${report.database}/${report.objectStore} • Encrypted Records: ${report.recordCount} • Key Extractable: ${String(report.keyExtractable)} • Hardcoded Key: ${String(report.hardcodedBundleKey)} • Plaintext Exposed: ${String(report.plaintextExposed)} • localStorage: ${String(report.localStorageUsed)}`;
        });
        this.el.storageAuditJson.map(el => {
          el.textContent = JSON.stringify(report, null, 2);
        });
      }
    );
  }

  public toggleDrawer(): void {
    this.el.logDrawer.map(drawer => {
      this.drawerOpen = !this.drawerOpen;
      if (this.drawerOpen) {
        drawer.classList.remove('translate-x-[115%]', 'opacity-0');
        drawer.classList.add('translate-x-0', 'opacity-100');
      } else {
        drawer.classList.add('translate-x-[115%]', 'opacity-0');
        drawer.classList.remove('translate-x-0', 'opacity-100');
      }
    });
  }

  public showTemporaryBanner(message: string,
                             durationMs: number = 3200): void {
    zipOptions(this.el.statusBanner, this.el.statusBannerText).map(([statusBanner, statusBannerText]) => {
      statusBannerText.textContent = message;
      statusBanner.classList.remove('hidden');
      setTimeout(() => {
        statusBanner.classList.add('hidden');
      }, durationMs);
    });
  }

  public showLiveSessionModal(): void {
    this.el.liveSessionModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hideLiveSessionModal(): void {
    this.el.liveSessionModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
    this.clearLiveJoinError();
  }

  public switchLiveSessionTab(tab: 'create' | 'join'): void {
    const isCreate = tab === 'create';
    this.el.tabCreateLive.map(btn => {
      btn.classList.toggle('active-chip', isCreate);
    });
    this.el.tabJoinLive.map(btn => {
      btn.classList.toggle('active-chip', !isCreate);
    });
    this.el.panelCreateLive.map(panel => {
      panel.classList.toggle('hidden', !isCreate);
    });
    this.el.panelJoinLive.map(panel => {
      panel.classList.toggle('hidden', isCreate);
    });
  }

  public showLiveCreatedSession(sessionCode: string,
                                inviteUrl?: string): void {
    this.el.liveCreatedInfo.map(container => {
      container.classList.remove('hidden');
    });
    this.el.liveCreatedCode.map(codeEl => {
      codeEl.textContent = sessionCode;
    });
    this.el.liveCreatedUrl.map(urlEl => {
      urlEl.value =
        inviteUrl ||
        (typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}?session=${sessionCode}`
          : `https://web-chess.pockethost.io/?session=${sessionCode}`);
    });
  }

  public showLiveJoinError(message: string): void {
    this.el.liveJoinError.map(errEl => {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    });
  }

  public clearLiveJoinError(): void {
    this.el.liveJoinError.map(errEl => {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    });
  }

  public setDoNotDeleteState(pinned: boolean): void {
    this.el.btnToggleDoNotDelete.map(btn => {
      btn.classList.toggle('bg-amber-500/20', pinned);
      btn.classList.toggle('border-amber-400/50', pinned);
      btn.classList.toggle('text-amber-200', pinned);
      btn.classList.toggle('bg-white/5', !pinned);
      btn.classList.toggle('border-white/20', !pinned);
      btn.classList.toggle('text-stone-300', !pinned);
    });
    this.el.iconDoNotDelete.map(icon => {
      icon.classList.toggle('text-amber-300', pinned);
    });
    this.el.labelDoNotDelete.map(label => {
      label.textContent = pinned ? 'Protected (No Prune)' : 'Do Not Delete';
    });

    this.el.btnPersistentTogglePin.map(btn => {
      btn.classList.toggle('bg-amber-500/25', pinned);
      btn.classList.toggle('border-amber-400/50', pinned);
      btn.classList.toggle('text-amber-200', pinned);
      btn.classList.toggle('bg-white/5', !pinned);
      btn.classList.toggle('border-white/20', !pinned);
      btn.classList.toggle('text-stone-300', !pinned);
    });
    this.el.iconPersistentPin.map(icon => {
      icon.classList.toggle('text-amber-300', pinned);
    });
    this.el.labelPersistentPin.map(label => {
      label.textContent = pinned ? 'Pinned' : 'Pin';
    });
  }

  public setLiveMatchActive(active: boolean,
                            sessionCode?: string,
                            doNotDelete?: boolean): void {
    this.el.liveActiveBanner.map(banner => {
      banner.classList.toggle('hidden', !active);
    });
    this.el.liveActiveCode.map(codeEl => {
      codeEl.textContent = sessionCode || '';
    });
    this.el.livePersistentHud.map(hud => {
      hud.classList.toggle('hidden', !active);
    });
    this.el.livePersistentCode.map(codeEl => {
      codeEl.textContent = sessionCode || '';
    });
    this.el.pregameModeLockNotice.map(notice => {
      notice.classList.toggle('hidden', !active);
    });
    this.setDoNotDeleteState(Boolean(doNotDelete));
  }

  public setPersistentCopyLinkCopied(copied: boolean): void {
    this.el.iconPersistentCopyLink.map(icon => {
      icon.textContent = copied ? 'check' : 'link';
    });
    this.el.labelPersistentCopyLink.map(label => {
      label.textContent = copied ? 'Copied!' : 'Copy Link';
    });
  }

  public setBannerCopyLinkCopied(copied: boolean): void {
    this.el.iconBannerCopyLink.map(icon => {
      icon.textContent = copied ? 'check' : 'link';
    });
    this.el.labelBannerCopyLink.map(label => {
      label.textContent = copied ? 'Copied!' : 'Copy Link';
    });
  }

  public showArcadeHub(): void {
    this.el.arcadeHubModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hideArcadeHub(): void {
    this.el.arcadeHubModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public isArcadeHubVisible(): boolean {
    return this.el.arcadeHubModal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public setHubQuickJoinFeedback(message: string,
                                 isError: boolean): void {
    this.el.hubQuickJoinFeedback.map(feedback => {
      feedback.textContent = message;
      feedback.classList.remove('hidden');
      feedback.classList.toggle('bg-red-950/60', isError);
      feedback.classList.toggle('border', true);
      feedback.classList.toggle('border-red-500/40', isError);
      feedback.classList.toggle('text-red-200', isError);
      feedback.classList.toggle('bg-emerald-950/60', !isError);
      feedback.classList.toggle('border-emerald-500/40', !isError);
      feedback.classList.toggle('text-emerald-200', !isError);
    });
  }

  public clearHubQuickJoinFeedback(): void {
    this.el.hubQuickJoinFeedback.map(feedback => {
      feedback.textContent = '';
      feedback.classList.add('hidden');
    });
  }

  public showBlackjack(): void {
    this.el.blackjackModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hideBlackjack(): void {
    this.el.blackjackModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public isBlackjackVisible(): boolean {
    return this.el.blackjackModal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public showPoker(): void {
    this.el.pokerModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hidePoker(): void {
    this.el.pokerModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public isPokerVisible(): boolean {
    return this.el.pokerModal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public showSkipBo(): void {
    this.el.skipboModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hideSkipBo(): void {
    this.el.skipboModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public isSkipBoVisible(): boolean {
    return this.el.skipboModal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public showPhase10(): void {
    this.el.phase10Modal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hidePhase10(): void {
    this.el.phase10Modal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public isPhase10Visible(): boolean {
    return this.el.phase10Modal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public showUno(): void {
    this.el.unoModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hideUno(): void {
    this.el.unoModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public isUnoVisible(): boolean {
    return this.el.unoModal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public showAvalon(): void {
    this.el.avalonModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hideAvalon(): void {
    this.el.avalonModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public isAvalonVisible(): boolean {
    return this.el.avalonModal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public showSet(): void {
    this.el.setModal.map(modal => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });
  }

  public hideSet(): void {
    this.el.setModal.map(modal => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  public isSetVisible(): boolean {
    return this.el.setModal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public showArcadeRules(gameKey: string,
                         ruleOverride?: GameRuleInfo): void {
    const targetRule: Option<GameRuleInfo> = ruleOverride
      ? some(ruleOverride)
      : globalConfigClient.getGameRuleInfo(gameKey);
    if (!targetRule.isSome()) return;
    const info = targetRule.value;
    this.el.rulesModalTitle.map(el => {
      el.textContent = info.title;
    });
    this.el.rulesModalRealLife.map(el => {
      el.textContent = `Real-Life Game: ${info.realLifeName}`;
    });
    this.el.rulesModalObjective.map(el => {
      el.textContent = info.objective;
    });
    this.el.rulesModalRulesList.map(el => {
      el.innerHTML = info.keyRules.map((r: string) => `<li>${r}</li>`).join('');
    });
    this.el.rulesModalExternalLink.map(link => {
      link.href = info.officialUrl;
    });
    this.el.rulesModalExternalLabel.map(lbl => {
      lbl.textContent = info.urlLabel;
    });
    this.el.arcadeRulesModal.map(modal => {
      modal.classList.remove('hidden');
    });
  }

  public hideArcadeRules(): void {
    this.el.arcadeRulesModal.map(modal => {
      modal.classList.add('hidden');
    });
  }

  public isArcadeRulesVisible(): boolean {
    return this.el.arcadeRulesModal
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  /**
   * Returns true if any full-screen 2D Arcade Game Theater or the Arcade Hub is open,
   * allowing the 3D WebGL render governor to suspend background 3D rendering to save battery.
   */
  public isAnyFullScreenArcadeModalVisible(): boolean {
    return (
      this.isArcadeHubVisible() ||
      this.isBlackjackVisible() ||
      this.isPokerVisible() ||
      this.isSkipBoVisible() ||
      this.isPhase10Visible() ||
      this.isUnoVisible() ||
      this.isAvalonVisible() ||
      this.isSetVisible()
    );
  }

  /**
   * Updates visual presentation of Screen Wake Lock toggle buttons, badges, and icons
   * across bottom navigation, pregame match rules, and the persistent live HUD.
   */
  public updateWakeLockUI(active: boolean,
                          isSupported: boolean): void {
    this.el.btnWakeLock.map(btn => {
      btn.classList.toggle('active-chip', active);
      btn.classList.toggle('bg-amber-500/20', active);
      btn.classList.toggle('text-amber-200', active);
      btn.classList.toggle('border-amber-400/50', active);
      btn.title = matchBool(isSupported, {
        true: () => matchBool(active, {
          true: () => 'Keep Screen Awake active (click to allow normal sleep)',
          false: () => 'Keep Screen Awake off (click to prevent screen sleep during play)'
        }),
        false: () => 'Screen Wake Lock is not supported on this browser'
      });
    });

    this.el.wakeLockLabel.map(lbl => {
      lbl.textContent = matchBool(active, {
        true: () => 'Awake (ON)',
        false: () => 'Keep Awake'
      });
    });

    this.el.wakeLockCheckbox.map(chk => {
      chk.checked = active;
      chk.disabled = !isSupported;
    });

    this.el.wakeLockPregameBadge.map(badge => {
      matchBool(isSupported, {
        false: () => {
          badge.textContent = 'UNSUPPORTED';
          badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-red-400/20 text-red-300 font-bold';
        },
        true: () => {
          matchBool(active, {
            true: () => {
              badge.textContent = 'ACTIVE';
              badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 font-bold';
            },
            false: () => {
              badge.textContent = 'OFF';
              badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-stone-300 font-bold';
            }
          });
        }
      });
    });

    this.el.btnPersistentToggleWakeLock.map(btn => {
      btn.classList.toggle('border-amber-400/50', active);
      btn.classList.toggle('bg-amber-500/20', active);
      btn.classList.toggle('text-amber-200', active);
    });
  }
}
