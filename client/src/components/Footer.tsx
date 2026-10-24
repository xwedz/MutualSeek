import { profileUrl } from '../api';

const AUTHOR = { name: 'Morinara', osuId: 7452418 };
const SOURCE_URL = 'https://github.com/xwedz/MutualSeek';

const linkClass = 'font-medium text-ink transition-colors hover:text-pink';

export function Footer() {
    return (
        <footer className="mt-16 flex flex-col gap-2 border-t border-line pt-6 pb-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
                Made by{' '}
                <a href={profileUrl(AUTHOR.osuId)} target="_blank" rel="noreferrer" className={linkClass}>
                    {AUTHOR.name}
                </a>
                <span className="mx-2 text-muted/60">·</span>
                <a href={SOURCE_URL} target="_blank" rel="noreferrer" className={linkClass}>
                    Source code
                </a>
            </p>
            <p>Not affiliated with osu! or ppy Pty Ltd.</p>
        </footer>
    );
}
