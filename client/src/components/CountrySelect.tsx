import { countryName } from '../countries';
import { ChevronIcon } from './Icons';

interface Props {
    value: string; // 'all' or a country code
    countries: string[]; // country codes that have candidates, largest first
    onChange: (value: string) => void;
}

/**
 * Country menu. A native <select>: phones open the system picker, which is the easiest to use,
 * and on desktop typing (e.g. "Tai") jumps to that country.
 * No counts: they only update hourly and don't exclude the user's friends, so they wouldn't match the list and would confuse more than help.
 */
export function CountrySelect({ value, countries, onChange }: Props) {
    // The selected country must be in the menu even before it has candidates (e.g. the user's own country), or the menu and list wouldn't match
    const list = value !== 'all' && !countries.includes(value) ? [...countries, value] : countries;

    return (
        <label className="relative inline-flex items-center">
            <span className="sr-only">Country</span>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="appearance-none rounded-xl border border-line bg-surface py-2 pr-9 pl-3 text-sm text-ink transition-colors hover:border-pink/50 focus:border-pink/60 focus:outline-none"
            >
                <option value="all">All countries</option>
                {list.map(code => (
                    <option key={code} value={code}>
                        {countryName(code)}
                    </option>
                ))}
            </select>
            <ChevronIcon size={14} className="pointer-events-none absolute right-3 text-muted" />
        </label>
    );
}
