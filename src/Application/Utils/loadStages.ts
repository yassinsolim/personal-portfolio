import UIEventBus from '../UI/EventBus';

// real loading progress, for whatever loader is on screen. each step is a
// 'load:stage' event on the ui bus and a 'load:<scope>:<stage>' performance
// mark when it starts:
//   homepage: download (progress by bytes), upload (textures to the gpu),
//             compile (the room's programs, in parallel), ready (drawn)
//   race:     download (race code and track), build (the world, a slice a
//             frame), then the transition's phases (start, fly, settled,
//             handoff, reveal, done)
export type LoadScope = 'homepage' | 'race';

export type LoadStage = {
    scope: LoadScope;
    stage: string;
    // 0 to 1 within the stage
    progress: number;
    done: boolean;
    loaded?: number;
    total?: number;
    bytesLoaded?: number;
    bytesTotal?: number;
};

const latest = new Map<LoadScope, LoadStage>();

export const reportStage = (
    scope: LoadScope,
    stage: string,
    progress = 0,
    detail: Partial<LoadStage> = {}
) => {
    const event: LoadStage = {
        ...detail,
        scope,
        stage,
        progress: Math.min(1, Math.max(0, progress)),
        done: progress >= 1,
    };
    if (latest.get(scope)?.stage !== stage) performance.mark?.(`load:${scope}:${stage}`);
    latest.set(scope, event);
    UIEventBus.dispatch('load:stage', event);
};

// the last one reported, for a loader that mounts after it
export const currentStage = (scope: LoadScope) => latest.get(scope) || null;
