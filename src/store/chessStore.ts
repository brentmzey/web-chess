import {
  clearSessionState,
  getPersistencePreference,
  loadSessionOutcome,
  saveSessionState,
  SESSION_KEY,
  setPersistencePreference,
  wipeAllStorage
} from '../storage/indexedDbStore';
import {
  ChessThemeEnum,
  DeviceTierEnum,
  GameModeEnum,
  OpponentDifficultyEnum,
  StorageLoadStatusEnum,
  type StorageLoadOutcome,
  type StoredLiveSessionInfo,
  type StoredSessionState
} from '../types';
import {
  fromNullable,
  match,
  matchBool,
  none,
  success,
  type Option,
  type Result
} from '../utils/fp';
import { currentEpochMs } from '../utils/dateTime';

export const INITIAL_BOARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' as const;

export interface ChessStoreState {
  fen: string;
  history: string[];
  mode: GameModeEnum;
  difficulty: OpponentDifficultyEnum;
  allowUndo: boolean;
  theme: ChessThemeEnum;
  useActionCam: boolean;
  gameStarted: boolean;
  persistenceEnabled: boolean;
  contrast: number;
  brightness: number;
  deviceTier: DeviceTierEnum;
  isThinking: boolean;
  selectedSquare: Option<string>;
  keepScreenAwake: boolean;
  legalMovesForSelected: string[];
  pendingPromotionMove: Option<{ from: string; to: string }>;
  isGameOver: boolean;
  gameOverTitle: Option<string>;
  gameOverSubtitle: Option<string>;
  lastPersistedTimestamp: number;
  liveSession?: StoredLiveSessionInfo;
}

export const DEFAULT_CHESS_STORE_STATE: ChessStoreState = {
  fen: INITIAL_BOARD_FEN,
  history: [],
  mode: GameModeEnum.Minimax,
  difficulty: OpponentDifficultyEnum.Balanced,
  allowUndo: true,
  theme: ChessThemeEnum.GothicBasilica,
  useActionCam: true,
  gameStarted: false,
  persistenceEnabled: true,
  contrast: 100,
  brightness: 100,
  deviceTier: DeviceTierEnum.Desktop,
  isThinking: false,
  selectedSquare: none(),
  keepScreenAwake: false,
  legalMovesForSelected: [],
  pendingPromotionMove: none(),
  isGameOver: false,
  gameOverTitle: none(),
  gameOverSubtitle: none(),
  lastPersistedTimestamp: 0,
  liveSession: undefined
};

export type StoreListener = (
  state: Readonly<ChessStoreState>,
  prevState: Readonly<ChessStoreState>
) => void;

/**
 * Functional, reactive State Store managing unified chess match state,
 * encrypted IndexedDB persistence, auto-save, and tab-refresh rehydration.
 */
export class ChessStore {
  private state: ChessStoreState;
  private listeners: Set<StoreListener> = new Set();
  private isHydrated: boolean = false;

  constructor(initialState?: Partial<ChessStoreState>) {
    this.state = {
      ...DEFAULT_CHESS_STORE_STATE,
      ...initialState
    };
  }

  /**
   * Returns an immutable snapshot of the active application state.
   */
  public getState(): Readonly<ChessStoreState> {
    return this.state;
  }

  /**
   * Returns whether the store has been hydrated from storage.
   */
  public getIsHydrated(): boolean {
    return this.isHydrated;
  }

  /**
   * Functional state updater: updates state immutably and notifies all subscribers.
   */
  public setState(
    updater:
      | Partial<ChessStoreState>
      | ((prevState: Readonly<ChessStoreState>) => Partial<ChessStoreState>)
  ): void {
    const prevState = this.state;
    const patch = typeof updater === 'function' ? updater(prevState) : updater;
    this.state = {
      ...prevState,
      ...patch
    };

    this.notifyListeners(this.state, prevState);
  }

  /**
   * Registers a reactive state subscriber. Returns an unsubscribe function.
   */
  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(
    nextState: Readonly<ChessStoreState>,
    prevState: Readonly<ChessStoreState>
  ): void {
    this.listeners.forEach(listener => {
      listener(nextState, prevState);
    });
  }

  /**
   * Encrypts and persists current store state to IndexedDB (`sanctuary_sessions`).
   */
  public async saveToStorage(): Promise<Result<void, string>> {
    return matchBool(this.state.persistenceEnabled, {
      false: async () => success(undefined),
      true: async () => {
        const payload: StoredSessionState = {
          id: SESSION_KEY,
          enabled: true,
          fen: this.state.fen,
          history: [...this.state.history],
          mode: this.state.mode,
          difficulty: this.state.difficulty,
          allowUndo: this.state.allowUndo,
          theme: this.state.theme,
          contrast: this.state.contrast,
          brightness: this.state.brightness,
          deviceTier: this.state.deviceTier,
          timestamp: currentEpochMs(),
          gameStarted: this.state.gameStarted,
          useActionCam: this.state.useActionCam,
          keepScreenAwake: this.state.keepScreenAwake,
          liveSession: this.state.liveSession
        };

        const res = await saveSessionState(payload);
        return res.map(() => {
          this.state = {
            ...this.state,
            lastPersistedTimestamp: payload.timestamp
          };
        });
      }
    });
  }

  /**
   * Restores encrypted state from IndexedDB into the store.
   */
  public async loadFromStorage(): Promise<StorageLoadOutcome> {
    const outcome = await loadSessionOutcome();

    match(outcome.status, {
      [StorageLoadStatusEnum.Restored]: () => {
        fromNullable(outcome.session).map(saved => {
          this.applySavedSession(saved);
        });
      },
      [StorageLoadStatusEnum.Empty]: () => {},
      [StorageLoadStatusEnum.Unreadable]: () => {},
      [StorageLoadStatusEnum.Unavailable]: () => {
        this.setState({ persistenceEnabled: false });
      }
    });

    return outcome;
  }

  private applySavedSession(saved: StoredSessionState): void {
    const restoredMode = matchBool(
      saved.mode === GameModeEnum.GeminiNano &&
        this.state.deviceTier === DeviceTierEnum.MobileLite,
      {
        true: () => GameModeEnum.MicroNeural,
        false: () => (fromNullable(saved.mode).getOrElse(GameModeEnum.Minimax) as GameModeEnum)
      }
    );

    const hasStarted =
      Boolean(saved.gameStarted) || (Array.isArray(saved.history) && saved.history.length > 0);

    this.setState({
      fen: fromNullable(saved.fen).getOrElse(INITIAL_BOARD_FEN),
      history: Array.isArray(saved.history) ? [...saved.history] : [],
      mode: restoredMode,
      difficulty: fromNullable(saved.difficulty).getOrElse(OpponentDifficultyEnum.Balanced) as OpponentDifficultyEnum,
      allowUndo: fromNullable(saved.allowUndo).getOrElse(true),
      theme: fromNullable(saved.theme).getOrElse(ChessThemeEnum.GothicBasilica) as ChessThemeEnum,
      contrast: typeof saved.contrast === 'number' ? saved.contrast : this.state.contrast,
      brightness: typeof saved.brightness === 'number' ? saved.brightness : this.state.brightness,
      useActionCam: fromNullable(saved.useActionCam).getOrElse(this.state.useActionCam),
      keepScreenAwake: fromNullable(saved.keepScreenAwake).getOrElse(false),
      gameStarted: hasStarted,
      lastPersistedTimestamp: saved.timestamp || currentEpochMs(),
      liveSession: saved.liveSession
    });
  }

  /**
   * Initializes store on application boot: checks preference and hydrates from storage.
   */
  public async hydrate(): Promise<StorageLoadOutcome> {
    const preference = await getPersistencePreference();
    this.setState({ persistenceEnabled: preference });

    const outcome = await matchBool(preference, {
      true: async () => this.loadFromStorage(),
      false: async () => ({ status: StorageLoadStatusEnum.Empty })
    });

    this.isHydrated = true;
    return outcome;
  }

  /**
   * Toggles persistence preference: updates store and persists or clears storage.
   */
  public async setPersistence(enabled: boolean): Promise<Result<void, string>> {
    this.setState({ persistenceEnabled: enabled });
    const prefResult = await setPersistencePreference(enabled);

    return prefResult.flatMapAsync(async () =>
      matchBool(enabled, {
        true: async () => this.saveToStorage(),
        false: async () => clearSessionState()
      })
    );
  }

  /**
   * Starts a new game or resets the match, updating state and immediately persisting.
   */
  public async resetMatch(defaults?: Partial<ChessStoreState>): Promise<void> {
    this.setState({
      fen: INITIAL_BOARD_FEN,
      history: [],
      selectedSquare: none(),
      legalMovesForSelected: [],
      pendingPromotionMove: none(),
      isThinking: false,
      isGameOver: false,
      gameOverTitle: none(),
      gameOverSubtitle: none(),
      gameStarted: true,
      ...defaults
    });

    await this.saveToStorage();
  }

  /**
   * Wipes all persistent storage and resets the store to pristine defaults.
   */
  public async wipeAll(): Promise<Result<void, string>> {
    const wipeRes = await wipeAllStorage();
    return wipeRes.map(() => {
      this.state = {
        ...DEFAULT_CHESS_STORE_STATE,
        deviceTier: this.state.deviceTier
      };
      this.notifyListeners(this.state, DEFAULT_CHESS_STORE_STATE);
    });
  }

  /**
   * Sets up browser lifecycle listeners (`pagehide`, `visibilitychange`, `beforeunload`)
   * to guarantee that store state is flushed and persisted on tab refresh or close.
   */
  public setupLifecycleListeners(
    targetWindow: Window = window,
    targetDoc: Document = document
  ): () => void {
    const handleFlush = (): void => {
      void this.saveToStorage();
    };

    const handleVisibility = (): void => {
      matchBool(targetDoc.visibilityState === 'hidden', {
        true: () => handleFlush(),
        false: () => {}
      });
    };

    fromNullable(targetWindow).map(w => {
      w.addEventListener('pagehide', handleFlush);
      w.addEventListener('beforeunload', handleFlush);
    });

    fromNullable(targetDoc).map(d => {
      d.addEventListener('visibilitychange', handleVisibility);
    });

    return () => {
      fromNullable(targetWindow).map(w => {
        w.removeEventListener('pagehide', handleFlush);
        w.removeEventListener('beforeunload', handleFlush);
      });
      fromNullable(targetDoc).map(d => {
        d.removeEventListener('visibilitychange', handleVisibility);
      });
    };
  }
}

/** Global shared instance of the application chess store */
export const chessStore = new ChessStore();
