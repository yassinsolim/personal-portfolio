type EventCallback<T> = (data: T) => unknown;

const handlers = new Map<string, Map<unknown, EventListener>>();

const UIEventBus = {
    on<T>(event: string, callback: EventCallback<T>) {
        let eventHandlers = handlers.get(event);
        if (!eventHandlers) {
            eventHandlers = new Map();
            handlers.set(event, eventHandlers);
        }

        if (eventHandlers.has(callback)) {
            return;
        }

        const handler = (event: Event) => {
            const customEvent = event as CustomEvent<T>;
            callback(customEvent.detail);
        };
        eventHandlers.set(callback, handler);
        document.addEventListener(event, handler);
    },
    dispatch<T>(event: string, data: T) {
        document.dispatchEvent(new CustomEvent<T>(event, { detail: data }));
    },
    remove<T>(event: string, callback: EventCallback<T>) {
        const eventHandlers = handlers.get(event);
        const handler = eventHandlers?.get(callback);
        if (!handler) {
            return;
        }

        document.removeEventListener(event, handler);
        eventHandlers?.delete(callback);
        if (eventHandlers?.size === 0) {
            handlers.delete(event);
        }
    },
};

export default UIEventBus;
