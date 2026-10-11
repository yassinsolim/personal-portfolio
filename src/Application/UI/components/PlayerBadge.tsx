import React from 'react';
import { initialsOf, type Avatar } from '../../Racing/Profile/profile';

// a driver's badge: a glyph, their initials or their number on their color
const GLYPHS: Record<Exclude<Avatar, 'initials' | 'number'>, string> = {
    helmet: 'M12 4a8.5 8.5 0 0 0-8.5 8.5V17a2 2 0 0 0 2 2h10.2a2 2 0 0 0 1.8-1.1l2.6-5.3A8.5 8.5 0 0 0 12 4zm1 5.5h6.6a7 7 0 0 1 .6 3H13z',
    wheel: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 0 1 6.9 6H5.1A7 7 0 0 1 12 5zm-6.9 8h4.4l1.5 1.5V19a7 7 0 0 1-5.9-6zm7.9 6v-4.5l1.5-1.5h4.4a7 7 0 0 1-5.9 6z',
    flag: 'M4.5 3h1.6v18H4.5zM7.5 4h4v3.5h-4zm8 0h4v3.5h-4zm-4 3.5h4V11h-4zm-4 3.5h4v3.5h-4zm8 0h4v3.5h-4z',
    bolt: 'M13.5 2 4.5 14h6.2l-1.2 8 9-12.2h-6.2z',
    flame: 'M12 2c1 3.5-3 5.5-3 9.5a3 3 0 0 0 6 0c0-1.2-.6-2.2-1-3 2.6 1.4 4.5 3.9 4.5 6.5a6.5 6.5 0 0 1-13 0C5.5 8.5 12 6 12 2z',
    crown: 'M3 7.5l4.6 4.2L12 4.5l4.4 7.2L21 7.5 19 18H5zM5 19.5h14V21H5z',
    star: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z',
    wing: 'M2 7h20v3.5H2zm4 3.5h2.2V16H6zm9.8 0H18V16h-2.2zM3.5 16h17v2.5h-17z',
    turbo: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    piston: 'M6.5 3h11v7h-11zm2.5 8h6l-1.6 4h-2.8zm1.6 5h2.8v5h-2.8z',
    shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5zm0 3.2L7 7v4c0 3.5 2.2 6.4 5 7.9z',
    ghost: 'M12 3a7 7 0 0 0-7 7v11l2.3-1.8L9.7 21l2.3-1.8 2.3 1.8 2.4-1.8L19 21V10a7 7 0 0 0-7-7zM9.5 9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
    peak: 'M2 20 9 7.5l3.4 5.4L15 9.5 22 20z',
};

// dark ink on a light color, light on a dark one
const inkFor = (color: string) => {
    const value = parseInt(color.slice(1), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#111214' : '#ffffff';
};

type Props = {
    avatar: Avatar;
    color: string;
    name: string;
    number: number | null;
    size?: number;
};

const PlayerBadge = ({ avatar, color, name, number, size = 28 }: Props) => {
    const text =
        avatar === 'initials' ? initialsOf(name) : avatar === 'number' ? (number === null ? '#' : String(number)) : null;
    return (
        <span
            className="player-badge"
            style={{ width: size, height: size, background: color, color: inkFor(color) }}
            aria-hidden="true"
        >
            {text === null ? (
                <svg viewBox="0 0 24 24">
                    <path d={GLYPHS[avatar as keyof typeof GLYPHS]} fillRule="evenodd" />
                </svg>
            ) : (
                <b style={{ fontSize: Math.round(size * (text.length > 1 ? 0.38 : 0.5)) }}>{text}</b>
            )}
            {number !== null && avatar !== 'number' && size >= 48 ? <i>{number}</i> : null}
        </span>
    );
};

// a lap or run with no profile behind it
export const NAMELESS_COLOR = '#2c2d31';

export default PlayerBadge;
