// the hybrid loading screen's room specific settings, the only part a new
// room should need to change:
//   dockTarget   the screen the terminal docks onto (World/intro/dockTarget.ts):
//                'monitor' for today's room, or a mesh name in a new one
//                (?dock=<name> overrides it for trying)
//   dockAtStage  the pipeline stage that brings the dock
//   panelWidth   the panel's width in its own pixels; its height follows the
//                target's shape, today's monitor is 1280 by 1024
export const HYBRID = {
    dockTarget: 'monitor',
    dockAtStage: 'texture',
    panelWidth: 1280,
    panelHeight: 1024,
};

export const dockTargetName = () => {
    try {
        return new URLSearchParams(window.location.search).get('dock') || HYBRID.dockTarget;
    } catch {
        return HYBRID.dockTarget;
    }
};
