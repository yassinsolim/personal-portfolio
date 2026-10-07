import React from 'react';
import { TRACK_OUTLINES } from '../trackOutlines';

// a track's lap as a line, the start a dot
const TrackMap = ({ track }: { track: keyof typeof TRACK_OUTLINES }) => {
    const map = TRACK_OUTLINES[track];
    return (
        <svg
            className="track-map"
            viewBox={map.viewBox}
            preserveAspectRatio="xMinYMid meet"
            aria-hidden="true"
            focusable="false"
        >
            <path d={map.path} />
            <circle cx={map.start[0]} cy={map.start[1]} r="3.5" />
        </svg>
    );
};

export default TrackMap;
