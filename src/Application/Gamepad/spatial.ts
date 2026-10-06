// moving the controller's focus like a tv remote (android's focus finder):
// boxes ahead of this one in the pressed direction, those lined up with it
// first, then the nearest by 13 x along squared plus across squared

import type { Direction } from './pad';

export type Box = { left: number; top: number; right: number; bottom: number };

const horizontal = (direction: Direction) =>
    direction === 'left' || direction === 'right';

// ahead of the source in that direction, not just overlapping it
const isCandidate = (source: Box, box: Box, direction: Direction) => {
    switch (direction) {
        case 'left':
            return (
                (source.right > box.right || source.left >= box.right) &&
                source.left > box.left
            );
        case 'right':
            return (
                (source.left < box.left || source.right <= box.left) &&
                source.right < box.right
            );
        case 'up':
            return (
                (source.bottom > box.bottom || source.top >= box.bottom) &&
                source.top > box.top
            );
        default:
            return (
                (source.top < box.top || source.bottom <= box.top) &&
                source.bottom < box.bottom
            );
    }
};

// lined up with the source across the direction of travel
const inBeam = (source: Box, box: Box, direction: Direction) =>
    horizontal(direction)
        ? box.bottom > source.top && box.top < source.bottom
        : box.right > source.left && box.left < source.right;

// wholly past the source's edge
const isPast = (source: Box, box: Box, direction: Direction) => {
    switch (direction) {
        case 'left':
            return source.left >= box.right;
        case 'right':
            return source.right <= box.left;
        case 'up':
            return source.top >= box.bottom;
        default:
            return source.bottom <= box.top;
    }
};

const along = (source: Box, box: Box, direction: Direction) => {
    switch (direction) {
        case 'left':
            return Math.max(0, source.left - box.right);
        case 'right':
            return Math.max(0, box.left - source.right);
        case 'up':
            return Math.max(0, source.top - box.bottom);
        default:
            return Math.max(0, box.top - source.bottom);
    }
};

const alongToFarEdge = (source: Box, box: Box, direction: Direction) => {
    switch (direction) {
        case 'left':
            return Math.max(1, source.left - box.left);
        case 'right':
            return Math.max(1, box.right - source.right);
        case 'up':
            return Math.max(1, source.top - box.top);
        default:
            return Math.max(1, box.bottom - source.bottom);
    }
};

const across = (source: Box, box: Box, direction: Direction) =>
    horizontal(direction)
        ? Math.abs(
              (source.top + source.bottom) / 2 - (box.top + box.bottom) / 2,
          )
        : Math.abs(
              (source.left + source.right) / 2 - (box.left + box.right) / 2,
          );

const beamBeats = (source: Box, a: Box, b: Box, direction: Direction) => {
    if (inBeam(source, b, direction) || !inBeam(source, a, direction))
        return false;
    if (!isPast(source, b, direction)) return true;
    if (horizontal(direction)) return true;
    return along(source, a, direction) < alongToFarEdge(source, b, direction);
};

const weighted = (source: Box, box: Box, direction: Direction) => {
    const major = along(source, box, direction);
    const minor = across(source, box, direction);
    return 13 * major * major + minor * minor;
};

const isBetter = (source: Box, a: Box, b: Box, direction: Direction) => {
    if (!isCandidate(source, a, direction)) return false;
    if (!isCandidate(source, b, direction)) return true;
    if (beamBeats(source, a, b, direction)) return true;
    if (beamBeats(source, b, a, direction)) return false;
    return weighted(source, a, direction) < weighted(source, b, direction);
};

// the index of the box to move to, or -1 when nothing is that way
export const pickInDirection = (
    source: Box,
    boxes: Box[],
    direction: Direction,
) => {
    let best = -1;
    boxes.forEach((box, index) => {
        if (box === source) return;
        if (
            best < 0
                ? isCandidate(source, box, direction)
                : isBetter(source, box, boxes[best], direction)
        ) {
            best = index;
        }
    });
    return best;
};
