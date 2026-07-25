// Inline stroke icons (Phosphor-flavored) — self-contained, currentColor.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const IconOverview = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IconPayments = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4h13a1 1 0 0 1 1 1v15l-2.5-1.5L13 20l-2.5-1.5L8 20l-2.5-1.5L4 20V5a1 1 0 0 1 1-1Z" />
    <path d="M8 9h6M8 13h6" />
  </svg>
);

export const IconAnalytics = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <rect x="7" y="12" width="3" height="5" rx="0.5" />
    <rect x="12" y="8" width="3" height="9" rx="0.5" />
    <rect x="17" y="5" width="3" height="12" rx="0.5" />
  </svg>
);

export const IconFeatures = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="7" r="2.5" />
    <path d="M11 7h9M4 7h1" />
    <circle cx="16" cy="17" r="2.5" />
    <path d="M13 17H4M19 17h1" />
  </svg>
);

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7.7 1.6 1.6 0 0 1-3.2 0 1.6 1.6 0 0 0-2.7-.7l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 1 0-3.2 1.6 1.6 0 0 0 .7-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-.7 1.6 1.6 0 0 1 3.2 0 1.6 1.6 0 0 0 2.7.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 1 0 3Z" />
  </svg>
);

export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base({ strokeWidth: 2.4, ...p })}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const IconWallet = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" />
    <path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z" />
    <circle cx="16" cy="13" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconShield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6l7-3Z" />
    <path d="M9.5 12l1.8 1.8 3.7-3.8" />
  </svg>
);

export const IconBolt = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </svg>
);

export const IconTrend = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M21 7v5h-5" />
  </svg>
);

export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01M11 12h1v4h1" />
  </svg>
);

export const IconExport = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v13M7 11l5 5 5-5M5 21h14" />
  </svg>
);

export const IconApis = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l9 5-9 5-9-5 9-5Z" />
    <path d="M3 12l9 5 9-5" />
    <path d="M3 16l9 5 9-5" />
  </svg>
);

export const IconPlug = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 2v6M15 2v6" />
    <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
    <path d="M12 17v5" />
  </svg>
);
