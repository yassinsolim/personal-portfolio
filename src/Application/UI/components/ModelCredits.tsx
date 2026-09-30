import React from 'react';
import { MODEL_CREDITS } from '../../modelCredits';

const External = ({
    href,
    children,
}: {
    href: string;
    children: React.ReactNode;
}) => (
    <a href={href} rel="noreferrer noopener" target="_blank">
        {children}
    </a>
);

// the 3d model credits under the race menu's track credits, collapsed so the
// menu stays short
const ModelCredits = () => (
    <details className="race-menu-credits model-credits">
        <summary>3D models</summary>
        <ul>
            {MODEL_CREDITS.map((credit) => (
                <li key={credit.usedFor}>
                    {credit.usedFor}:{' '}
                    {credit.sourceUrl ? (
                        <External href={credit.sourceUrl}>
                            "{credit.title}"
                        </External>
                    ) : (
                        <>"{credit.title}"</>
                    )}{' '}
                    by{' '}
                    {credit.authorUrl ? (
                        <External href={credit.authorUrl}>
                            {credit.author}
                        </External>
                    ) : (
                        credit.author
                    )}
                    ,{' '}
                    {credit.license ? (
                        <External href={credit.license.url}>
                            {credit.license.label}
                        </External>
                    ) : (
                        (credit.shared ?? 'source and license unknown')
                    )}
                    . Changes: {credit.changes}.
                    {credit.license?.shareAlike &&
                        ` Our adapted version is shared under ${credit.license.label}.`}
                </li>
            ))}
        </ul>
    </details>
);

export default ModelCredits;
