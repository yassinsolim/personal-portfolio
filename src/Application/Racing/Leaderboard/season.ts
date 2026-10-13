// the season tag on car_id. bumped whenever lap times stop being comparable
// (last: walls and grass costing real time, before that the clock waiting
// for the car to move). the board reads the current tag, and the season
// before stays viewable as last season. older rows stay too
export const SEASON_TAG = '@v7';
export const LAST_SEASON_TAG = '@v6';

export type Season = 'current' | 'last';

export const seasonTag = (season: Season = 'current') => (season === 'last' ? LAST_SEASON_TAG : SEASON_TAG);
