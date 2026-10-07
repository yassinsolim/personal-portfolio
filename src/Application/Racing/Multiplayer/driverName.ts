// names for the leaderboard and the lobbies. a first drive is offered a
// made-up one, so a player who skips the name isn't one more "Driver"
const FIRST = [
    'Apex',
    'Turbo',
    'Nitro',
    'Redline',
    'Slick',
    'Rapid',
    'Silent',
    'Lucky',
    'Rolling',
    'Swift',
    'Wild',
    'Late',
    'Flying',
    'Midnight',
];
const SECOND = [
    'Fox',
    'Hawk',
    'Comet',
    'Viper',
    'Ghost',
    'Rocket',
    'Lynx',
    'Bolt',
    'Falcon',
    'Badger',
    'Shark',
    'Otter',
    'Wolf',
    'Cobra',
];
// the database takes 1 to 16 characters
export const MAX_DRIVER_NAME = 16;

export const randomDriverName = (random: () => number = Math.random) => {
    const pick = (list: string[]) => list[Math.floor(random() * list.length)];
    const name = `${pick(FIRST)} ${pick(SECOND)}`;
    const numbered = `${name} ${10 + Math.floor(random() * 90)}`;
    return numbered.length <= MAX_DRIVER_NAME ? numbered : name;
};

// an empty name goes out as "Driver", so that one was never picked either
export const isDefaultDriverName = (name: string | null | undefined) => {
    const clean = String(name || '').trim();
    return !clean || clean === 'Driver';
};
