import { carOptionsById } from '../../carOptions';

// what the pause menu's board shows: the ring's stock or tuned laps (all
// cars or one), or the drift park's runs
export type BoardQuery = {
    track: 'ring' | 'drift';
    board: 'stock' | 'tuned';
    carId: string | null;
};

// laps on the menu's board
export const BOARD_SIZE = 50;

export const sanitizeBoardQuery = (state: unknown): BoardQuery => {
    const source = (state && typeof state === 'object' ? state : {}) as Record<string, unknown>;
    return {
        track: source.track === 'drift' ? 'drift' : 'ring',
        board: source.board === 'tuned' ? 'tuned' : 'stock',
        carId: typeof source.carId === 'string' && carOptionsById[source.carId] ? source.carId : null,
    };
};

export const sameBoardQuery = (a: BoardQuery, b: BoardQuery) =>
    a.track === b.track && a.board === b.board && a.carId === b.carId;
