type NavigatorWithHints = Navigator & { deviceMemory?: number; brave?: unknown };

export const isMobileDevice = () =>
    Boolean(
        window.matchMedia?.('(pointer: coarse)').matches ||
        window.matchMedia?.('(max-width: 820px)').matches ||
        window.matchMedia?.('(max-height: 520px)').matches
    );

// safari and firefox don't expose deviceMemory, so unknown has to count as
// fine or every mac in safari gets treated as a low power device. brave makes
// both numbers up, so there only the phone check counts
export const isLowPowerDevice = () => {
    const { deviceMemory, hardwareConcurrency, brave } =
        navigator as NavigatorWithHints;
    if (brave) return isMobileDevice();
    return (
        isMobileDevice() ||
        (Boolean(hardwareConcurrency) && hardwareConcurrency <= 4) ||
        (deviceMemory !== undefined && deviceMemory <= 4)
    );
};
