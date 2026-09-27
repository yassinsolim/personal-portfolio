type NavigatorWithHints = Navigator & { deviceMemory?: number };

export const isMobileDevice = () =>
    Boolean(
        window.matchMedia?.('(pointer: coarse)').matches ||
        window.matchMedia?.('(max-width: 820px)').matches ||
        window.matchMedia?.('(max-height: 520px)').matches
    );

// safari and firefox don't expose deviceMemory, so unknown has to count as
// fine or every mac in safari gets treated as a low power device
export const isLowPowerDevice = () => {
    const { deviceMemory, hardwareConcurrency } =
        navigator as NavigatorWithHints;
    return (
        isMobileDevice() ||
        (Boolean(hardwareConcurrency) && hardwareConcurrency <= 4) ||
        (deviceMemory !== undefined && deviceMemory <= 4)
    );
};
