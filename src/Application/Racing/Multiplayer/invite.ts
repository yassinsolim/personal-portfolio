// invite links: ?lobby=CODE drops a friend straight into your lobby when they
// start racing, from the play button or by clicking the car
export const sanitizeInviteCode = (value: string) =>
    String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);

export const getInviteLobbyCode = () => {
    try {
        return sanitizeInviteCode(
            new URLSearchParams(window.location.search).get('lobby') || ''
        );
    } catch {
        return '';
    }
};

export const buildInviteLink = (code: string) => {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('lobby', sanitizeInviteCode(code));
    return url.toString();
};
