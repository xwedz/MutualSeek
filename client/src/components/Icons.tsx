// 線條風格的 SVG 圖示（不用 emoji 當圖示）。stroke 用 currentColor，顏色跟著文字走。

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...props}
        >
            {children}
        </svg>
    );
}

export const ExternalIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="M14 4h6v6" />
        <path d="M20 4 10 14" />
        <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </Icon>
);

export const CopyIcon = (p: IconProps) => (
    <Icon {...p}>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </Icon>
);

export const CheckIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="m5 12 5 5 9-10" />
    </Icon>
);

export const SkipIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
    </Icon>
);

export const RefreshIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
        <path d="M4 4v4h4" />
        <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
        <path d="M20 20v-4h-4" />
    </Icon>
);

export const LogoutIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
        <path d="M10 17 5 12l5-5" />
        <path d="M5 12h11" />
    </Icon>
);

export const UserPlusIcon = (p: IconProps) => (
    <Icon {...p}>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 20a7 7 0 0 1 14 0" />
        <path d="M19 8v6" />
        <path d="M16 11h6" />
    </Icon>
);

export const UserMinusIcon = (p: IconProps) => (
    <Icon {...p}>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 20a7 7 0 0 1 14 0" />
        <path d="M16 11h6" />
    </Icon>
);

export const LinkIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="M9 15 15 9" />
        <path d="M11 6.5 12.5 5a4.2 4.2 0 0 1 6 6L17 12.5" />
        <path d="M13 17.5 11.5 19a4.2 4.2 0 0 1-6-6L7 11.5" />
    </Icon>
);

export const UnlinkIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="M11 6.5 12.5 5a4.2 4.2 0 0 1 6 6L17 12.5" />
        <path d="M13 17.5 11.5 19a4.2 4.2 0 0 1-6-6L7 11.5" />
        <path d="M4 4l16 16" />
    </Icon>
);

export const LockIcon = (p: IconProps) => (
    <Icon {...p}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
);

export const ChevronIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="m6 9 6 6 6-6" />
    </Icon>
);

export const PencilIcon = (p: IconProps) => (
    <Icon {...p}>
        <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    </Icon>
);

export const InfoIcon = (p: IconProps) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
    </Icon>
);

export const Spinner =({ size = 16 }: { size?: number }) => (
    <Icon size={size} className="animate-spin-slow">
        <path d="M12 3a9 9 0 1 0 9 9" />
    </Icon>
);
