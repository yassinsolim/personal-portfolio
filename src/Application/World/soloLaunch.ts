// the fly-in asks "how do you want to drive?" only when the launch did not
// already choose solo. the car, the Play Solo tag, and the monitor button pass
// ask: false. the garage path never reaches this, because it returns first.

export const opensLobbyChoice = ({
    active,
    toGarage,
    hasInvite,
    ask,
}: {
    active: boolean;
    toGarage: boolean;
    hasInvite: boolean;
    ask: boolean;
}): boolean => active && !toGarage && !hasInvite && ask;
