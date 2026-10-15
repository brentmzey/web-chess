declare module 'chess.js' {
  export type Square =
    | 'a8' | 'b8' | 'c8' | 'd8' | 'e8' | 'f8' | 'g8' | 'h8'
    | 'a7' | 'b7' | 'c7' | 'd7' | 'e7' | 'f7' | 'g7' | 'h7'
    | 'a6' | 'b6' | 'c6' | 'd6' | 'e6' | 'f6' | 'g6' | 'h6'
    | 'a5' | 'b5' | 'c5' | 'd5' | 'e5' | 'f5' | 'g5' | 'h5'
    | 'a4' | 'b4' | 'c4' | 'd4' | 'e4' | 'f4' | 'g4' | 'h4'
    | 'a3' | 'b3' | 'c3' | 'd3' | 'e3' | 'f3' | 'g3' | 'h3'
    | 'a2' | 'b2' | 'c2' | 'd2' | 'e2' | 'f2' | 'g2' | 'h2'
    | 'a1' | 'b1' | 'c1' | 'd1' | 'e1' | 'f1' | 'g1' | 'h1';

  export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  export type PieceColor = 'w' | 'b';

  export interface Piece {
    type: PieceType;
    color: PieceColor;
  }

  export interface Move {
    color: PieceColor;
    from: Square;
    to: Square;
    flags: string;
    piece: PieceType;
    san: string;
    captured?: PieceType;
    promotion?: PieceType;
  }

  export interface ShortMove {
    from: string;
    to: string;
    promotion?: string;
  }

  export class Chess {
    constructor(fen?: string);
    board(): (Piece | null)[][];
    turn(): PieceColor;
    moves(options?: { verbose?: false; square?: string }): string[];
    moves(options: { verbose: true; square?: string }): Move[];
    move(move: string | ShortMove, options?: { sloppy?: boolean }): Move | null;
    undo(): Move | null;
    history(options?: { verbose?: false }): string[];
    history(options: { verbose: true }): Move[];
    in_check(): boolean;
    in_checkmate(): boolean;
    in_draw(): boolean;
    in_stalemate(): boolean;
    in_threefold_repetition(): boolean;
    insufficient_material(): boolean;
    game_over(): boolean;
    fen(): string;
    get(square: Square | string): Piece | null;
    reset(): void;
  }
}
