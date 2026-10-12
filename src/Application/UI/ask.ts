import eventBus from './EventBus';

let serial = 0;

// a question for the race (RaceManager) and its answer, matched by id
export const ask = <T>(request: string, payload: Record<string, unknown> = {}) =>
    new Promise<T>((resolve) => {
        const id = ++serial;
        const done = `${request}:done`;
        const onAnswer = (answer: { id?: unknown; result: T } | undefined) => {
            if (!answer || answer.id !== id) return;
            eventBus.remove(done, onAnswer);
            resolve(answer.result);
        };
        eventBus.on(done, onAnswer);
        eventBus.dispatch(request, { ...payload, id });
    });
