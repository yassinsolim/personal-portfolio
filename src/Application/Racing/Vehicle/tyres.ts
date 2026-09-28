// rolling radius of a tyre, the radius that turns wheel rpm into road speed.
// tyre makers measure it as revolutions per mile under load (sae j1025); where
// that's published for the size we use it. otherwise the loaded circumference
// is taken as 0.970 of the nominal one, the average of the measured sizes in
// docs/cars-drivetrain.md (0.969 to 0.974)

const METERS_PER_MILE = 1609.344;
const LOADED_CIRCUMFERENCE = 0.97;

// nominal outside diameter of a metric size like '265/40 ZR18', meters
export const tyreDiameter = (size: string) => {
    const match = /(\d{3})\/(\d{2})\s*Z?R\s*(\d{2})/i.exec(size);
    if (!match) return NaN;
    const width = Number(match[1]);
    const aspect = Number(match[2]);
    const rim = Number(match[3]);
    return (rim * 25.4 + (2 * width * aspect) / 100) / 1000;
};

export const rollingRadius = (size: string, revsPerMile?: number) => {
    if (revsPerMile && revsPerMile > 0) {
        return METERS_PER_MILE / revsPerMile / (2 * Math.PI);
    }
    return (LOADED_CIRCUMFERENCE * tyreDiameter(size)) / 2;
};
