import { countryName } from '../countries';
import { ChevronIcon } from './Icons';

interface Props {
    value: string; // 'all' 或國家代碼
    countries: string[]; // 有候選人的國家代碼，依人數由多到少
    onChange: (value: string) => void;
}

/**
 * 國家選單。用瀏覽器原生的 <select>：手機上會開系統內建的選擇介面，最好操作；
 * 桌面上展開後直接打字（例如 "Tai"）可以跳到該國家。
 * 不顯示人數：人數每小時才更新、也沒扣掉使用者已經加的好友，跟列表實際顯示的數量對不上，反而容易混淆。
 */
export function CountrySelect({ value, countries, onChange }: Props) {
    // 目前選的國家還沒有候選人時（例如使用者自己的國家），也要出現在選單裡，不然畫面會對不上
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
