import React from 'react';
import ModelCredits from './ModelCredits';

// visible on the room panel and in the pause menu. the per-model list stays
// in the disclosure; licenses come from modelCredits.ts, not from this text
const ShellCredits = () => (
    <div className="shell-credits">
        <p>
            Car meshes are third-party models under their own licenses. The
            GT63 S was shared by friends of Yassin, and the other cars are
            Sketchfab models. The room shell started from{' '}
            <a
                href="https://github.com/henryjeff/portfolio-website"
                rel="noreferrer noopener"
                target="_blank"
            >
                Henry Heffernan&apos;s portfolio
            </a>{' '}
            (MIT). The desktop on the monitor is{' '}
            <a
                href="https://github.com/DustinBrett/daedalOS"
                rel="noreferrer noopener"
                target="_blank"
            >
                Dustin Brett&apos;s daedalOS
            </a>{' '}
            (MIT).
        </p>
        <ModelCredits />
    </div>
);

export default ShellCredits;
