// where driving solo from the room starts: the ring or the drift park. picked
// on the room panel and kept between visits, so clicking the car goes there too
export type StartTrack = 'ring' | 'drift';

const START_TRACK_KEY = 'yassinverse:startTrack:v1';

export const readStartTrack = (): StartTrack => {
    try {
        return window.localStorage.getItem(START_TRACK_KEY) === 'drift' ? 'drift' : 'ring';
    } catch {
        return 'ring';
    }
};

export const writeStartTrack = (track: StartTrack) => {
    try {
        window.localStorage.setItem(START_TRACK_KEY, track);
    } catch {
        // no-op
    }
};
