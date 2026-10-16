import type { Chess, Move } from 'chess.js';
import { UNICODE_PIECES } from '../constants/board';
import type { GameMode, PieceType } from '../types';
import { fromNullable, match } from '../utils/fp';

export interface UIControllerElements {
  turnDot: HTMLElement | null;
  turnText: HTMLElement | null;
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
  promotionModal: HTMLElement | null;
}

export class UIController {
  private el: UIControllerElements;
  public drawerOpen: boolean = false;

  constructor() {
    this.el = {
      turnDot: document.getElementById('turn-dot'),
      turnText: document.getElementById('turn-text'),
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
      promotionModal: document.getElementById('promotion-modal')
    };
  }

  public update(chess: Chess, mode: GameMode, customStatus?: string): void {
    const turn = chess.turn();

    if (this.el.turnDot && this.el.turnText) {
      if (turn === 'w') {
        this.el.turnDot.className = 'w-2.5 h-2.5 rounded-full bg-stone-100 shadow-[0_0_8px_#fff] transition-colors duration-300';
        this.el.turnText.textContent = "White Marble's Turn";
      } else {
        this.el.turnDot.className = 'w-2.5 h-2.5 rounded-full bg-purple-400 shadow-[0_0_8px_#a855f7] transition-colors duration-300';
        this.el.turnText.textContent = fromNullable(customStatus).getOrElse(
          match(mode, {
            'pass-and-play': () => "Black Obsidian's Turn",
            'minimax': () => "Minimax (2-Ply) Thinking...",
            'micro-neural': () => "Micro-Neural AI Evaluating...",
            'gemini-nano': () => "Gemini Nano (Local LLM) Thinking..."
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
    const shatteredBlack: string[] = [];
    const shatteredWhite: string[] = [];

    history.forEach((m: Move) => {
      if (m.captured) {
        if (m.color === 'w') {
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
        ? shatteredBlack.map(icon => `<span class="text-lg leading-none">${icon}</span>`).join('')
        : '<span class="text-xs text-stone-600 italic">None yet</span>';
    }

    if (this.el.shatteredWhiteList) {
      this.el.shatteredWhiteList.innerHTML = shatteredWhite.length
        ? shatteredWhite.map(icon => `<span class="text-lg leading-none">${icon}</span>`).join('')
        : '<span class="text-xs text-stone-600 italic">None yet</span>';
    }

    if (this.el.moveCountPill) {
      this.el.moveCountPill.textContent = String(history.length);
    }

    if (this.el.moveHistoryContainer) {
      if (history.length === 0) {
        this.el.moveHistoryContainer.innerHTML = '<div class="text-stone-500 italic text-center py-8">Select a piece on the Crossing Altar to command your forces.</div>';
      } else {
        let html = '';
        for (let i = 0; i < history.length; i += 2) {
          const moveNum = Math.floor(i / 2) + 1;
          const wMove = history[i]!;
          const bMove = history[i + 1];
          const wCap = wMove.captured ? '⚔️' : '';
          const bCap = bMove && bMove.captured ? '⚔️' : '';
          html += `
            <div class="grid grid-cols-7 items-center py-1 px-2 rounded-lg ${moveNum % 2 === 0 ? 'bg-white/5' : ''}">
                <span class="col-span-1 text-stone-500">${moveNum}.</span>
                <span class="col-span-3 text-amber-100 font-medium">${wMove.san} ${wCap}</span>
                <span class="col-span-3 text-purple-300 font-medium">${bMove ? bMove.san + ' ' + bCap : ''}</span>
            </div>
          `;
        }
        this.el.moveHistoryContainer.innerHTML = html;
        this.el.moveHistoryContainer.scrollTop = this.el.moveHistoryContainer.scrollHeight;
      }
    }
  }

  public showGameOver(chess: Chess): void {
    if (!this.el.gameoverModal || !this.el.gameoverTitle || !this.el.gameoverSubtitle) return;

    if (chess.in_checkmate()) {
      const winner = chess.turn() === 'w' ? 'Black Obsidian' : 'White Marble';
      this.el.gameoverTitle.textContent = 'CHECKMATE';
      this.el.gameoverSubtitle.textContent = `${winner} triumphs inside the High Gothic Basilica!`;
    } else {
      this.el.gameoverTitle.textContent = 'STALEMATE / DRAW';
      this.el.gameoverSubtitle.textContent = 'Neither army yields inside the sacred sanctuary.';
    }

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
}

