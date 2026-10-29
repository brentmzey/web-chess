import { Option, Result, fromNullable, none, some, success, failure } from '../../utils/fp';
import { currentEpochMs } from '../../utils/dateTime';
import { logger } from '../../utils/logger';
import { HotSwapActionEnum, AIModelEnum } from '../../constants/gameEnums';

export interface TableSeat<TPlayerData = Record<string, unknown>> {
  seatNumber: number;
  isOccupied: boolean;
  isBot: boolean;
  playerId: string;
  playerName: string;
  botModel: Option<string>;
  extraData: TPlayerData;
}

export interface HotSwapEvent {
  seatNumber: number;
  action: HotSwapActionEnum | 'bot_filled' | 'human_claimed' | 'human_vacated_bot_restored';
  previousPlayerName: string;
  newPlayerName: string;
  isBot: boolean;
  botModel: Option<string>;
  timestamp: number;
}

export class TableSeatManager<TPlayerData = Record<string, unknown>> {
  private seats: Map<number, TableSeat<TPlayerData>> = new Map();
  private maxSeats: number;
  private minSeats: number;
  private defaultBotModel: string;
  private defaultExtraDataProvider?: (seatNumber: number) => TPlayerData;
  private eventHistory: HotSwapEvent[] = [];

  constructor(maxSeats: number,
              minSeats: number = 2,
              defaultBotModel: string = AIModelEnum.MicroNeural,
              defaultExtraDataProvider?: (seatNumber: number) => TPlayerData) {
    this.maxSeats = maxSeats;
    this.minSeats = minSeats;
    this.defaultBotModel = defaultBotModel;
    this.defaultExtraDataProvider = defaultExtraDataProvider;

    // Initialize all empty seat slots
    for (let i = 1; i <= maxSeats; i++) {
      this.seats.set(i, {
        seatNumber: i,
        isOccupied: false,
        isBot: false,
        playerId: '',
        playerName: '',
        botModel: none(),
        extraData: defaultExtraDataProvider ? defaultExtraDataProvider(i) : ({} as TPlayerData)
      });
    }
  }

  public getMaxSeats(): number {
    return this.maxSeats;
  }

  public getMinSeats(): number {
    return this.minSeats;
  }

  public getSeat(seatNumber: number): Option<TableSeat<TPlayerData>> {
    return fromNullable(this.seats.get(seatNumber));
  }

  public getAllSeats(): TableSeat<TPlayerData>[] {
    return Array.from(this.seats.values());
  }

  public getOccupiedSeats(): TableSeat<TPlayerData>[] {
    return this.getAllSeats().filter(s => s.isOccupied);
  }

  public getHumanSeats(): TableSeat<TPlayerData>[] {
    return this.getAllSeats().filter(s => s.isOccupied && !s.isBot);
  }

  public getBotSeats(): TableSeat<TPlayerData>[] {
    return this.getAllSeats().filter(s => s.isOccupied && s.isBot);
  }

  public getHumanCount(): number {
    return this.getHumanSeats().length;
  }

  public getBotCount(): number {
    return this.getBotSeats().length;
  }

  public getTotalOccupants(): number {
    return this.getOccupiedSeats().length;
  }

  public getHistory(): HotSwapEvent[] {
    return [...this.eventHistory];
  }

  /**
   * Fills all unoccupied seats with AI bots of the specified model.
   * Ensures the table can start immediately without waiting for human players.
   */
  public fillEmptySeatsWithBots(
    botModel: string = this.defaultBotModel,
    namePrefix: string = 'Abbot Bot'
  ): number {
    let filledCount = 0;
    for (let i = 1; i <= this.maxSeats; i++) {
      const seat = this.seats.get(i);
      if (seat && !seat.isOccupied) {
        const botName = `${namePrefix} #${i}`;
        const prevName = seat.playerName;
        seat.isOccupied = true;
        seat.isBot = true;
        seat.playerId = `bot-seat-${i}`;
        seat.playerName = botName;
        seat.botModel = some(botModel);
        if (this.defaultExtraDataProvider && Object.keys(seat.extraData as object || {}).length === 0) {
          seat.extraData = this.defaultExtraDataProvider(i);
        }

        const ev: HotSwapEvent = {
          seatNumber: i,
          action: 'bot_filled',
          previousPlayerName: prevName,
          newPlayerName: botName,
          isBot: true,
          botModel: some(botModel),
          timestamp: currentEpochMs()
        };
        this.eventHistory.push(ev);
        logger.info(`[HOT_SWAP] [SEAT_FILLED] Seat ${i} filled by ${botName} (${botModel})`);
        filledCount++;
      }
    }
    return filledCount;
  }

  /**
   * Claims a specific seat for a human player.
   * If the seat was occupied by a bot, the bot is hot-swapped out seamlessly.
   * If the seat is already occupied by another human, returns a Failure.
   */
  public claimSeat(
    seatNumber: number,
    humanPlayerId: string,
    humanPlayerName: string,
    initialExtraData?: Partial<TPlayerData>
  ): Result<TableSeat<TPlayerData>, string> {
    if (seatNumber < 1 || seatNumber > this.maxSeats) {
      return failure(`Invalid seat number ${seatNumber}. Must be between 1 and ${this.maxSeats}.`);
    }

    const seat = this.seats.get(seatNumber)!;
    if (seat.isOccupied && !seat.isBot && seat.playerId !== humanPlayerId) {
      return failure(`Seat ${seatNumber} is already occupied by human player ${seat.playerName}.`);
    }

    const prevName = seat.playerName || 'Empty';
    const wasBot = seat.isBot;
    seat.isOccupied = true;
    seat.isBot = false;
    seat.playerId = humanPlayerId;
    seat.playerName = humanPlayerName;
    seat.botModel = none();
    if (this.defaultExtraDataProvider && Object.keys(seat.extraData as object || {}).length === 0) {
      seat.extraData = this.defaultExtraDataProvider(seatNumber);
    }
    if (initialExtraData) {
      seat.extraData = { ...seat.extraData, ...initialExtraData };
    }

    const ev: HotSwapEvent = {
      seatNumber,
      action: 'human_claimed',
      previousPlayerName: prevName,
      newPlayerName: humanPlayerName,
      isBot: false,
      botModel: none(),
      timestamp: currentEpochMs()
    };
    this.eventHistory.push(ev);

    logger.info(
      `[HOT_SWAP] [SEAT_CLAIMED] Seat ${seatNumber} claimed by human ${humanPlayerName} ` +
        `(${wasBot ? `swapped out bot ${prevName}` : 'fresh claim'})`
    );

    return success(seat);
  }

  /**
   * Vacates a seat when a human player disconnects or exits.
   * Dynamically hot-swaps the vacant seat to an AI bot so the multiplayer game never stalls!
   */
  public vacateSeat(
    seatNumber: number,
    fallbackBotModel: string = this.defaultBotModel,
    botNamePrefix: string = 'Guardian Bot'
  ): Result<TableSeat<TPlayerData>, string> {
    if (seatNumber < 1 || seatNumber > this.maxSeats) {
      return failure(`Invalid seat number ${seatNumber}. Must be between 1 and ${this.maxSeats}.`);
    }

    const seat = this.seats.get(seatNumber)!;
    if (!seat.isOccupied) {
      return failure(`Seat ${seatNumber} is already vacant.`);
    }

    const prevName = seat.playerName;
    const botName = `${botNamePrefix} #${seatNumber}`;
    seat.isOccupied = true;
    seat.isBot = true;
    seat.playerId = `bot-seat-${seatNumber}`;
    seat.playerName = botName;
    seat.botModel = some(fallbackBotModel);

    const ev: HotSwapEvent = {
      seatNumber,
      action: 'human_vacated_bot_restored',
      previousPlayerName: prevName,
      newPlayerName: botName,
      isBot: true,
      botModel: some(fallbackBotModel),
      timestamp: currentEpochMs()
    };
    this.eventHistory.push(ev);

    logger.info(
      `[HOT_SWAP] [SEAT_VACATED] Human ${prevName} left Seat ${seatNumber}. Dynamically hot-swapped to ${botName} (${fallbackBotModel})`
    );

    return success(seat);
  }

  /**
   * Finds the first available seat (either empty or occupied by a bot),
   * and claims it for a human player.
   */
  public claimAnyAvailableSeat(
    humanPlayerId: string,
    humanPlayerName: string,
    initialExtraData?: Partial<TPlayerData>
  ): Result<TableSeat<TPlayerData>, string> {
    // First, look for an empty or bot seat
    for (let i = 1; i <= this.maxSeats; i++) {
      const seat = this.seats.get(i)!;
      if (!seat.isOccupied || seat.isBot || seat.playerId === humanPlayerId) {
        return this.claimSeat(i, humanPlayerId, humanPlayerName, initialExtraData);
      }
    }
    return failure(`Table is completely full with ${this.maxSeats} human players.`);
  }

  public updateSeatData(
    seatNumber: number,
    updater: (prev: TPlayerData) => TPlayerData
  ): Result<TableSeat<TPlayerData>, string> {
    const seatOpt = this.getSeat(seatNumber);
    return seatOpt.match({
      Some: seat => {
        seat.extraData = updater(seat.extraData);
        return success(seat);
      },
      None: () => failure(`Seat ${seatNumber} not found.`)
    });
  }
}
