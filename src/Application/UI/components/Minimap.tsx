import React, { useMemo } from 'react';

type Props = {
    outline: number[][];
    // lap fractions of the sector splits
    bounds: number[];
    x: number;
    z: number;
    heading: number;
    remotes: Array<{ x: number; z: number }>;
};

const SIZE = 180;
const PAD = 10;

// the whole lap, north up, scaled to fit. world z runs down the map
const Minimap = ({ outline, bounds, x, z, heading, remotes }: Props) => {
    const view = useMemo(() => {
        if (outline.length < 2) return null;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        outline.forEach(([px, pz]) => {
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minZ = Math.min(minZ, pz);
            maxZ = Math.max(maxZ, pz);
        });
        const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ);
        const offsetX = (SIZE - (maxX - minX) * scale) / 2;
        const offsetZ = (SIZE - (maxZ - minZ) * scale) / 2;
        const map = (px: number, pz: number) => [
            offsetX + (px - minX) * scale,
            offsetZ + (pz - minZ) * scale,
        ];
        const path =
            outline
                .map(([px, pz], i) => {
                    const [mx, mz] = map(px, pz);
                    return `${i ? 'L' : 'M'}${mx.toFixed(1)} ${mz.toFixed(1)}`;
                })
                .join(' ') + ' Z';
        const marks = [0, ...bounds].map((fraction) => {
            const point =
                outline[
                    Math.min(
                        outline.length - 1,
                        Math.round(fraction * outline.length)
                    )
                ];
            return map(point[0], point[1]);
        });
        return { map, path, marks };
    }, [outline, bounds]);

    if (!view) return null;
    const [cx, cz] = view.map(x, z);
    const deg = (-heading * 180) / Math.PI + 180;
    return (
        <svg
            className="race-minimap"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            data-prevent-click
            aria-hidden
        >
            <path d={view.path} className="track" />
            {view.marks.map(([mx, mz], i) => (
                <circle
                    key={i}
                    cx={mx}
                    cy={mz}
                    r={i === 0 ? 3.2 : 2.4}
                    className={i === 0 ? 'start' : 'split'}
                />
            ))}
            {remotes.map((remote, i) => {
                const [rx, rz] = view.map(remote.x, remote.z);
                return (
                    <circle
                        key={i}
                        cx={rx}
                        cy={rz}
                        r={3.2}
                        className="remote"
                    />
                );
            })}
            <g transform={`translate(${cx} ${cz}) rotate(${deg})`}>
                <path d="M0 -6 L4.5 5 L0 2.6 L-4.5 5 Z" className="me" />
            </g>
        </svg>
    );
};

export default Minimap;
