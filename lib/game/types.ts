export type BoardSize = 9 | 13 | 19;
export type Stone = "black" | "white";
export type Intersection = Stone | null;
export type Board = Intersection[][];

export type Position = {
  x: number;
  y: number;
};

export type MoveError = "out_of_bounds" | "occupied" | "suicide";

export type MoveResult =
  | {
      ok: true;
      board: Board;
      captured: Position[];
    }
  | {
      ok: false;
      board: Board;
      error: MoveError;
    };
