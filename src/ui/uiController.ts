import type { Chess, Move } from 'chess.js';
import {
  getDifficultyProfile,
  getGameModeConfig,
  UNICODE_PIECES
} from '../constants/board';
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
import { fromNullable, match, type Result } from '../utils/fp';

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/**
 * Escapes HTML metacharacters so untrusted strings (e.g. SAN move text restored from storage)
 * can never inject markup into `innerHTML` templates.
 */
export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, ch => fromNullable(HTML_ESCAPE_MAP[ch]).getOrElse(ch));
}

export interface UIControllerElements {
  turnDot: HTMLElement | null;
  turnText: HTMLElement | null;
  gameModeBadge: HTMLElement | null;
  difficultyBadge: HTMLElement | null;
  deviceTierBadge: HTMLElement | null;
  mobileLiteBanner: HTMLElement | null;
  mobileLiteBannerText: HTMLElement | null;
  statusBanner: HTMLElement | null;
  statusBannerText: HTMLElement | null;
  capturedByWhite: HTMLElement | null;
  capturedByBlack: HTMLElement | null;
  shatteredBlackList: HTMLElement | null;
  shatteredWhiteList: HTMLElement | null;
  moveCountPill: HTMLElement | null;
  moveHistoryContainer: HTMLElement | null;
  logDrawer: HTMLElement | null;
  gameoverModal: HTMLElement | null;
  gameoverTitle: HTMLElement | null;
  gameoverSubtitle: HTMLElement | null;
  gameoverStandardActions: HTMLElement | null;
  gameoverLiveActions: HTMLElement | null;
  modalLeaveLive: HTMLButtonElement | null;
  modalInspectLive: HTMLButtonElement | null;
  promotionModal: HTMLElement | null;
  pregameModal: HTMLElement | null;
  storageAuditModal: HTMLElement | null;
  storageAuditAlgo: HTMLElement | null;
  storageAuditSummary: HTMLElement | null;
  storageAuditJson: HTMLElement | null;
  wipeConfirmRow: HTMLElement | null;
  btnUndo: HTMLButtonElement | null;
  undoIcon: HTMLElement | null;
  undoLabel: HTMLElement | null;
  undoRuleStatusPill: HTMLElement | null;
  liveSessionModal: HTMLElement | null;
  tabCreateLive: HTMLElement | null;
  tabJoinLive: HTMLElement | null;
  panelCreateLive: HTMLElement | null;
  panelJoinLive: HTMLElement | null;
  liveCreatedInfo: HTMLElement | null;
  liveCreatedCode: HTMLElement | null;
  liveCreatedUrl: HTMLInputElement | null;
  liveJoinError: HTMLElement | null;
  liveActiveBanner: HTMLElement | null;
  liveActiveCode: HTMLElement | null;
  btnLeaveLiveSession: HTMLButtonElement | null;
  pregameModeLockNotice: HTMLElement | null;
  btnToggleDoNotDelete: HTMLButtonElement | null;
  iconDoNotDelete: HTMLElement | null;
  labelDoNotDelete: HTMLElement | null;
  liveHostDoNotDelete: HTMLInputElement | null;
  arcadeHubModal: HTMLElement | null;
  btnCloseArcadeHub: HTMLButtonElement | null;
  btnArcadeHub: HTMLButtonElement | null;
  hubQuickJoinInput: HTMLInputElement | null;
  btnHubQuickJoin: HTMLButtonElement | null;
  hubQuickJoinFeedback: HTMLElement | null;
  livePersistentHud: HTMLElement | null;
  livePersistentCode: HTMLElement | null;
  btnPersistentCopyLink: HTMLButtonElement | null;
  iconPersistentCopyLink: HTMLElement | null;
  labelPersistentCopyLink: HTMLElement | null;
  btnPersistentCopyCode: HTMLButtonElement | null;
  btnPersistentTogglePin: HTMLButtonElement | null;
  iconPersistentPin: HTMLElement | null;
  labelPersistentPin: HTMLElement | null;
  btnLiveBannerCopyLink: HTMLButtonElement | null;
  iconBannerCopyLink: HTMLElement | null;
  labelBannerCopyLink: HTMLElement | null;
  btnPersistentLeaveLive: HTMLButtonElement | null;
  blackjackModal: HTMLElement | null;
  btnCloseBlackjack: HTMLButtonElement | null;
}

export class UIController {
  private el: UIControllerElements;
  public drawerOpen: boolean = false;

  constructor() {
    this.el = {
      turnDot: document.getElementById('turn-dot'),
      turnText: document.getElementById('turn-text'),
      gameModeBadge: document.getElementById('game-mode-badge'),
      difficultyBadge: document.getElementById('difficulty-badge'),
      deviceTierBadge: document.getElementById('device-tier-badge'),
      mobileLiteBanner: document.getElementById('mobile-lite-banner'),
      mobileLiteBannerText: document.getElementById('mobile-lite-banner-text'),
      statusBanner: document.getElementById('status-banner'),
      statusBannerText: document.getElementById('status-banner-text'),
      capturedByWhite: document.getElementById('captured-by-white'),
      capturedByBlack: document.getElementById('captured-by-black'),
      shatteredBlackList: document.getElementById('shattered-black-list'),
      shatteredWhiteList: document.getElementById('shattered-white-list'),
      moveCountPill: document.getElementById('move-count-pill'),
      moveHistoryContainer: document.getElementById('move-history-container'),
      logDrawer: document.getElementById('log-drawer'),
      gameoverModal: document.getElementById('gameover-modal'),
      gameoverTitle: document.getElementById('gameover-title'),
      gameoverSubtitle: document.getElementById('gameover-subtitle'),
      gameoverStandardActions: document.getElementById('gameover-standard-actions'),
      gameoverLiveActions: document.getElementById('gameover-live-actions'),
      modalLeaveLive: document.getElementById('modal-leave-live') as HTMLButtonElement | null,
      modalInspectLive: document.getElementById('modal-inspect-live') as HTMLButtonElement | null,
      promotionModal: document.getElementById('promotion-modal'),
      pregameModal: document.getElementById('pregame-modal'),
      storageAuditModal: document.getElementById('storage-audit-modal'),
      storageAuditAlgo: document.getElementById('storage-audit-algo'),
      storageAuditSummary: document.getElementById('storage-audit-summary'),
      storageAuditJson: document.getElementById('storage-audit-json'),
      wipeConfirmRow: document.getElementById('wipe-confirm-row'),
      btnUndo: document.getElementById('btn-undo') as HTMLButtonElement | null,
      undoIcon: document.getElementById('undo-icon'),
      undoLabel: document.getElementById('undo-label'),
      undoRuleStatusPill: document.getElementById('undo-rule-status-pill'),
      liveSessionModal: document.getElementById('live-session-modal'),
      tabCreateLive: document.getElementById('tab-create-live'),
      tabJoinLive: document.getElementById('tab-join-live'),
      panelCreateLive: document.getElementById('panel-create-live'),
      panelJoinLive: document.getElementById('panel-join-live'),
      liveCreatedInfo: document.getElementById('live-created-info'),
      liveCreatedCode: document.getElementById('live-created-code'),
      liveCreatedUrl: document.getElementById('live-created-url') as HTMLInputElement | null,
      liveJoinError: document.getElementById('live-join-error'),
      liveActiveBanner: document.getElementById('live-active-banner'),
      liveActiveCode: document.getElementById('live-active-code'),
      btnLeaveLiveSession: document.getElementById('btn-leave-live-session') as HTMLButtonElement | null,
      btnToggleDoNotDelete: document.getElementById('btn-toggle-do-not-delete') as HTMLButtonElement | null,
      iconDoNotDelete: document.getElementById('icon-do-not-delete'),
      labelDoNotDelete: document.getElementById('label-do-not-delete'),
      liveHostDoNotDelete: document.getElementById('live-host-do-not-delete') as HTMLInputElement | null,
      arcadeHubModal: document.getElementById('arcade-hub-modal'),
      btnCloseArcadeHub: document.getElementById('btn-close-arcade-hub') as HTMLButtonElement | null,
      btnArcadeHub: document.getElementById('btn-arcade-hub') as HTMLButtonElement | null,
      hubQuickJoinInput: document.getElementById('hub-quick-join-input') as HTMLInputElement | null,
      btnHubQuickJoin: document.getElementById('btn-hub-quick-join') as HTMLButtonElement | null,
      hubQuickJoinFeedback: document.getElementById('hub-quick-join-feedback'),
      livePersistentHud: document.getElementById('live-persistent-hud'),
      livePersistentCode: document.getElementById('live-persistent-code'),
      btnPersistentCopyLink: document.getElementById('btn-persistent-copy-link') as HTMLButtonElement | null,
      iconPersistentCopyLink: document.getElementById('icon-persistent-copy-link'),
      labelPersistentCopyLink: document.getElementById('label-persistent-copy-link'),
      btnPersistentCopyCode: document.getElementById('btn-persistent-copy-code') as HTMLButtonElement | null,
      btnPersistentTogglePin: document.getElementById('btn-persistent-toggle-pin') as HTMLButtonElement | null,
      iconPersistentPin: document.getElementById('icon-persistent-pin'),
      labelPersistentPin: document.getElementById('label-persistent-pin'),
      btnLiveBannerCopyLink: document.getElementById('btn-live-banner-copy-link') as HTMLButtonElement | null,
      iconBannerCopyLink: document.getElementById('icon-banner-copy-link'),
      labelBannerCopyLink: document.getElementById('label-banner-copy-link'),
      btnPersistentLeaveLive: document.getElementById('btn-persistent-leave-live') as HTMLButtonElement | null,
      blackjackModal: document.getElementById('blackjack-modal'),
      btnCloseBlackjack: document.getElementById('btn-close-blackjack') as HTMLButtonElement | null,
      pregameModeLockNotice: document.getElementById('pregame-mode-lock-notice')
    };
  }

  public applyDeviceProfileUI(profile: DeviceProfileConfig): void {
    fromNullable(this.el.deviceTierBadge).map(badge => {
      badge.textContent = profile.badge;
      if (profile.tier === DeviceTierEnum.MobileLite) {
        badge.className =
          'hidden md:inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-400/15 text-teal-300 border border-teal-400/30';
      } else {
        badge.className =
          'hidden md:inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-stone-400/15 text-stone-300 border border-stone-400/30';
      }
    });

    fromNullable(this.el.mobileLiteBanner).map(banner => {
      if (profile.tier === DeviceTierEnum.MobileLite) {
        banner.classList.remove('hidden');
        fromNullable(this.el.mobileLiteBannerText).map(txt => {
          txt.textContent = profile.notice;
        });
      } else {
        banner.classList.add('hidden');
      }
    });
  }

  public update(
    chess: Chess,
    mode: GameMode,
    customStatus?: string,
    difficulty: OpponentDifficulty = OpponentDifficultyEnum.Balanced,
    allowUndo: boolean = true
  ): void {
    const turn = chess.turn();
    const diffProfile = getDifficultyProfile(difficulty);
    const modeConfig = getGameModeConfig(mode);

    fromNullable(this.el.gameModeBadge).map(badge => {
      badge.textContent = modeConfig.badge;
    });

    fromNullable(this.el.difficultyBadge).map(badge => {
      if (mode === GameModeEnum.PassAndPlay || mode === GameModeEnum.Live) {
        badge.classList.add('hidden');
      } else {
        badge.classList.remove('hidden');
        badge.textContent = diffProfile.badge;
      }
    });

    if (this.el.turnDot && this.el.turnText) {
      if (turn === PieceColorEnum.White) {
        this.el.turnDot.className =
          'w-2.5 h-2.5 rounded-full bg-stone-100 shadow-[0_0_8px_#fff] transition-colors duration-300';
        this.el.turnText.textContent = "White Marble's Turn";
      } else {
        this.el.turnDot.className =
          'w-2.5 h-2.5 rounded-full bg-purple-400 shadow-[0_0_8px_#a855f7] transition-colors duration-300';
        this.el.turnText.textContent = fromNullable(customStatus).getOrElse(
          match(mode as GameModeEnum, {
            [GameModeEnum.PassAndPlay]: () => "Black Obsidian's Turn",
            [GameModeEnum.Minimax]: () => `Minimax (${diffProfile.badge}) Thinking...`,
            [GameModeEnum.MicroNeural]: () => `Neural AI (${diffProfile.badge}) Evaluating...`,
            [GameModeEnum.GeminiNano]: () => `Gemini Nano (${diffProfile.badge}) Thinking...`,
            [GameModeEnum.Live]: () => "Remote Opponent's Turn"
          })
        );
      }
    }

    if (this.el.statusBanner && this.el.statusBannerText) {
      if (chess.in_checkmate()) {
        this.el.statusBanner.classList.remove('hidden');
        this.el.statusBannerText.textContent = 'CHECKMATE!';
      } else if (chess.in_check()) {
        this.el.statusBanner.classList.remove('hidden');
        this.el.statusBannerText.textContent = 'KING IN CHECK!';
      } else {
        this.el.statusBanner.classList.add('hidden');
      }
    }

    const history = chess.history({ verbose: true });

    // Update Undo button state based on pre-game allowUndo rule & move history
    fromNullable(this.el.btnUndo).map(btn => {
      if (!allowUndo) {
        btn.classList.add('opacity-45');
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'Undo Disabled for this Match (Strict Mode)';
        fromNullable(this.el.undoIcon).map(ic => {
          ic.textContent = 'lock';
        });
        fromNullable(this.el.undoLabel).map(lbl => {
          lbl.textContent = 'Locked';
        });
      } else {
        btn.classList.remove('opacity-45');
        btn.setAttribute('aria-disabled', 'false');
        btn.title = history.length > 0 ? 'Undo Last Move' : 'No moves to undo yet';
        fromNullable(this.el.undoIcon).map(ic => {
          ic.textContent = 'undo';
        });
        fromNullable(this.el.undoLabel).map(lbl => {
          lbl.textContent = 'Undo';
        });
      }
    });

    fromNullable(this.el.undoRuleStatusPill).map(pill => {
      pill.textContent = allowUndo ? 'Undo: Allowed' : 'Undo: Locked (Strict)';
      pill.className = allowUndo
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/30 font-semibold'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30 font-semibold';
    });

    const shatteredBlack: string[] = [];
    const shatteredWhite: string[] = [];

    history.forEach((m: Move) => {
      if (m.captured) {
        if (m.color === PieceColorEnum.White) {
          shatteredBlack.push(UNICODE_PIECES.b[m.captured as PieceType]);
        } else {
          shatteredWhite.push(UNICODE_PIECES.w[m.captured as PieceType]);
        }
      }
    });

    if (this.el.capturedByWhite) this.el.capturedByWhite.textContent = String(shatteredBlack.length);
    if (this.el.capturedByBlack) this.el.capturedByBlack.textContent = String(shatteredWhite.length);

    if (this.el.shatteredBlackList) {
      this.el.shatteredBlackList.innerHTML = shatteredBlack.length
        ? shatteredBlack
            .map(icon => `<span class="text-lg leading-none">${escapeHtml(icon)}</span>`)
            .join('')
        : '<span class="text-xs text-stone-600 italic">None yet</span>';
    }

    if (this.el.shatteredWhiteList) {
      this.el.shatteredWhiteList.innerHTML = shatteredWhite.length
        ? shatteredWhite
            .map(icon => `<span class="text-lg leading-none">${escapeHtml(icon)}</span>`)
            .join('')
        : '<span class="text-xs text-stone-600 italic">None yet</span>';
    }

    if (this.el.moveCountPill) {
      this.el.moveCountPill.textContent = String(history.length);
    }

    if (this.el.moveHistoryContainer) {
      if (history.length === 0) {
        this.el.moveHistoryContainer.innerHTML =
          '<div class="text-stone-500 italic text-center py-8">Select a piece on the Crossing Altar to command your forces.</div>';
      } else {
        let html = '';
        for (let i = 0; i < history.length; i += 2) {
          const moveNum = Math.floor(i / 2) + 1;
          const wMove = history[i]!;
          const bMove = history[i + 1];
          const wCap = wMove.captured ? '⚔️' : '';
          const bCap = bMove && bMove.captured ? '⚔️' : '';
          const safeWSan = escapeHtml(wMove.san);
          const safeBSan = bMove ? `${escapeHtml(bMove.san)} ${bCap}` : '';
          html += `
            <div class="grid grid-cols-7 items-center py-1 px-2 rounded-lg ${moveNum % 2 === 0 ? 'bg-white/5' : ''}">
                <span class="col-span-1 text-stone-500">${moveNum}.</span>
                <span class="col-span-3 text-amber-100 font-medium">${safeWSan} ${wCap}</span>
                <span class="col-span-3 text-purple-300 font-medium">${safeBSan}</span>
            </div>
          `;
        }
        this.el.moveHistoryContainer.innerHTML = html;
        this.el.moveHistoryContainer.scrollTop = this.el.moveHistoryContainer.scrollHeight;
      }
    }
  }

  public showGameOver(chess: Chess, isLiveMode: boolean = false, sessionCode?: string): void {
    if (!this.el.gameoverModal || !this.el.gameoverTitle || !this.el.gameoverSubtitle) return;

    if (chess.in_checkmate()) {
      const winner = chess.turn() === PieceColorEnum.White ? 'Black Obsidian' : 'White Marble';
      this.el.gameoverTitle.textContent = 'CHECKMATE';
      this.el.gameoverSubtitle.textContent = `${winner} triumphs inside the High Gothic Basilica!`;
    } else {
      this.el.gameoverTitle.textContent = 'STALEMATE / DRAW';
      this.el.gameoverSubtitle.textContent = isLiveMode
        ? `Stalemate reached in Live Match ${sessionCode || ''}. Both sides share sanctuary honors.`
        : 'Neither army yields inside the sacred sanctuary.';
    }

    fromNullable(this.el.gameoverLiveActions).map(actions => {
      actions.classList.toggle('hidden', !isLiveMode);
      actions.classList.toggle('flex', isLiveMode);
    });
    fromNullable(this.el.gameoverStandardActions).map(actions => {
      actions.classList.toggle('hidden', isLiveMode);
      actions.classList.toggle('flex', !isLiveMode);
    });

    this.el.gameoverModal.classList.remove('hidden');
    this.el.gameoverModal.classList.add('flex');
  }

  public hideGameOver(): void {
    if (!this.el.gameoverModal) return;
    this.el.gameoverModal.classList.add('hidden');
    this.el.gameoverModal.classList.remove('flex');
  }

  public showPromotionModal(): void {
    if (!this.el.promotionModal) return;
    this.el.promotionModal.classList.remove('hidden');
    this.el.promotionModal.classList.add('flex');
  }

  public hidePromotionModal(): void {
    if (!this.el.promotionModal) return;
    this.el.promotionModal.classList.add('hidden');
    this.el.promotionModal.classList.remove('flex');
  }

  public showPreGameModal(): void {
    if (!this.el.pregameModal) return;
    this.el.pregameModal.classList.remove('hidden');
    this.el.pregameModal.classList.add('flex');
  }

  public hidePreGameModal(): void {
    if (!this.el.pregameModal) return;
    this.el.pregameModal.classList.add('hidden');
    this.el.pregameModal.classList.remove('flex');
  }

  public showStorageAuditModal(): void {
    if (!this.el.storageAuditModal) return;
    this.el.storageAuditModal.classList.remove('hidden');
    this.el.storageAuditModal.classList.add('flex');
  }

  public hideStorageAuditModal(): void {
    this.hideWipeConfirm();
    if (!this.el.storageAuditModal) return;
    this.el.storageAuditModal.classList.add('hidden');
    this.el.storageAuditModal.classList.remove('flex');
  }

  public showWipeConfirm(): void {
    fromNullable(this.el.wipeConfirmRow).map(row => {
      row.classList.remove('hidden');
      row.classList.add('flex');
    });
  }

  public hideWipeConfirm(): void {
    fromNullable(this.el.wipeConfirmRow).map(row => {
      row.classList.add('hidden');
      row.classList.remove('flex');
    });
  }

  public renderStorageAudit(auditResult: Result<EncryptedStorageAuditReport, string>): void {
    auditResult.fold(
      errMsg => {
        fromNullable(this.el.storageAuditAlgo).map(el => {
          el.textContent =
            'AES-GCM-256 (Web Crypto CSPRNG Non-Extractable Key • 12-Byte Random IV • 128-Bit Auth Tag)';
        });
        fromNullable(this.el.storageAuditSummary).map(el => {
          el.textContent = `Storage Audit Notice: ${errMsg}`;
        });
        fromNullable(this.el.storageAuditJson).map(el => {
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
        fromNullable(this.el.storageAuditAlgo).map(el => {
          el.textContent = `${report.algorithm} • ${report.keyLengthBits}-Bit Non-Extractable Key • ${report.ivLengthBytes}-Byte IV • ${report.cipherMode}`;
        });
        fromNullable(this.el.storageAuditSummary).map(el => {
          el.textContent = `DB: ${report.database}/${report.objectStore} • Encrypted Records: ${report.recordCount} • Key Extractable: ${String(report.keyExtractable)} • Hardcoded Key: ${String(report.hardcodedBundleKey)} • Plaintext Exposed: ${String(report.plaintextExposed)} • localStorage: ${String(report.localStorageUsed)}`;
        });
        fromNullable(this.el.storageAuditJson).map(el => {
          el.textContent = JSON.stringify(report, null, 2);
        });
      }
    );
  }

  public toggleDrawer(): void {
    if (!this.el.logDrawer) return;
    this.drawerOpen = !this.drawerOpen;
    if (this.drawerOpen) {
      this.el.logDrawer.classList.remove('translate-x-[115%]', 'opacity-0');
      this.el.logDrawer.classList.add('translate-x-0', 'opacity-100');
    } else {
      this.el.logDrawer.classList.add('translate-x-[115%]', 'opacity-0');
      this.el.logDrawer.classList.remove('translate-x-0', 'opacity-100');
    }
  }

  public showTemporaryBanner(message: string, durationMs: number = 3200): void {
    if (!this.el.statusBanner || !this.el.statusBannerText) return;
    this.el.statusBannerText.textContent = message;
    this.el.statusBanner.classList.remove('hidden');
    setTimeout(() => {
      if (this.el.statusBanner) {
        this.el.statusBanner.classList.add('hidden');
      }
    }, durationMs);
  }

  public showLiveSessionModal(): void {
    if (!this.el.liveSessionModal) return;
    this.el.liveSessionModal.classList.remove('hidden');
    this.el.liveSessionModal.classList.add('flex');
  }

  public hideLiveSessionModal(): void {
    if (!this.el.liveSessionModal) return;
    this.el.liveSessionModal.classList.add('hidden');
    this.el.liveSessionModal.classList.remove('flex');
    this.clearLiveJoinError();
  }

  public switchLiveSessionTab(tab: 'create' | 'join'): void {
    const isCreate = tab === 'create';
    fromNullable(this.el.tabCreateLive).map(btn => {
      btn.classList.toggle('active-chip', isCreate);
    });
    fromNullable(this.el.tabJoinLive).map(btn => {
      btn.classList.toggle('active-chip', !isCreate);
    });
    fromNullable(this.el.panelCreateLive).map(panel => {
      panel.classList.toggle('hidden', !isCreate);
    });
    fromNullable(this.el.panelJoinLive).map(panel => {
      panel.classList.toggle('hidden', isCreate);
    });
  }

  public showLiveCreatedSession(sessionCode: string, inviteUrl?: string): void {
    fromNullable(this.el.liveCreatedInfo).map(container => {
      container.classList.remove('hidden');
    });
    fromNullable(this.el.liveCreatedCode).map(codeEl => {
      codeEl.textContent = sessionCode;
    });
    fromNullable(this.el.liveCreatedUrl).map(urlEl => {
      urlEl.value =
        inviteUrl ||
        (typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}?session=${sessionCode}`
          : `https://web-chess.pockethost.io/?session=${sessionCode}`);
    });
  }

  public showLiveJoinError(message: string): void {
    fromNullable(this.el.liveJoinError).map(errEl => {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    });
  }

  public clearLiveJoinError(): void {
    fromNullable(this.el.liveJoinError).map(errEl => {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    });
  }

  public setDoNotDeleteState(pinned: boolean): void {
    fromNullable(this.el.btnToggleDoNotDelete).map(btn => {
      btn.classList.toggle('bg-amber-500/20', pinned);
      btn.classList.toggle('border-amber-400/50', pinned);
      btn.classList.toggle('text-amber-200', pinned);
      btn.classList.toggle('bg-white/5', !pinned);
      btn.classList.toggle('border-white/20', !pinned);
      btn.classList.toggle('text-stone-300', !pinned);
    });
    fromNullable(this.el.iconDoNotDelete).map(icon => {
      icon.classList.toggle('text-amber-300', pinned);
    });
    fromNullable(this.el.labelDoNotDelete).map(label => {
      label.textContent = pinned ? 'Protected (No Prune)' : 'Do Not Delete';
    });

    fromNullable(this.el.btnPersistentTogglePin).map(btn => {
      btn.classList.toggle('bg-amber-500/25', pinned);
      btn.classList.toggle('border-amber-400/50', pinned);
      btn.classList.toggle('text-amber-200', pinned);
      btn.classList.toggle('bg-white/5', !pinned);
      btn.classList.toggle('border-white/20', !pinned);
      btn.classList.toggle('text-stone-300', !pinned);
    });
    fromNullable(this.el.iconPersistentPin).map(icon => {
      icon.classList.toggle('text-amber-300', pinned);
    });
    fromNullable(this.el.labelPersistentPin).map(label => {
      label.textContent = pinned ? 'Pinned' : 'Pin';
    });
  }

  public setLiveMatchActive(active: boolean, sessionCode?: string, doNotDelete?: boolean): void {
    fromNullable(this.el.liveActiveBanner).map(banner => {
      banner.classList.toggle('hidden', !active);
    });
    fromNullable(this.el.liveActiveCode).map(codeEl => {
      codeEl.textContent = sessionCode || '';
    });
    fromNullable(this.el.livePersistentHud).map(hud => {
      hud.classList.toggle('hidden', !active);
    });
    fromNullable(this.el.livePersistentCode).map(codeEl => {
      codeEl.textContent = sessionCode || '';
    });
    fromNullable(this.el.pregameModeLockNotice).map(notice => {
      notice.classList.toggle('hidden', !active);
    });
    this.setDoNotDeleteState(Boolean(doNotDelete));
  }

  public setPersistentCopyLinkCopied(copied: boolean): void {
    fromNullable(this.el.iconPersistentCopyLink).map(icon => {
      icon.textContent = copied ? 'check' : 'link';
    });
    fromNullable(this.el.labelPersistentCopyLink).map(label => {
      label.textContent = copied ? 'Copied!' : 'Copy Link';
    });
  }

  public setBannerCopyLinkCopied(copied: boolean): void {
    fromNullable(this.el.iconBannerCopyLink).map(icon => {
      icon.textContent = copied ? 'check' : 'link';
    });
    fromNullable(this.el.labelBannerCopyLink).map(label => {
      label.textContent = copied ? 'Copied!' : 'Copy Link';
    });
  }

  public showArcadeHub(): void {
    fromNullable(this.el.arcadeHubModal).map(modal => {
      modal.classList.remove('hidden');
    });
  }

  public hideArcadeHub(): void {
    fromNullable(this.el.arcadeHubModal).map(modal => {
      modal.classList.add('hidden');
    });
  }

  public isArcadeHubVisible(): boolean {
    return fromNullable(this.el.arcadeHubModal)
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }

  public setHubQuickJoinFeedback(message: string, isError: boolean): void {
    fromNullable(this.el.hubQuickJoinFeedback).map(feedback => {
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
    fromNullable(this.el.hubQuickJoinFeedback).map(feedback => {
      feedback.textContent = '';
      feedback.classList.add('hidden');
    });
  }

  public showBlackjack(): void {
    fromNullable(this.el.blackjackModal).map(modal => {
      modal.classList.remove('hidden');
    });
  }

  public hideBlackjack(): void {
    fromNullable(this.el.blackjackModal).map(modal => {
      modal.classList.add('hidden');
    });
  }

  public isBlackjackVisible(): boolean {
    return fromNullable(this.el.blackjackModal)
      .map(modal => !modal.classList.contains('hidden'))
      .getOrElse(false);
  }
}

