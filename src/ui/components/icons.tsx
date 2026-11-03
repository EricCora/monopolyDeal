import type { ReactNode } from 'react';

// Hand-drawn stand-ins for the SF Symbols the iOS app uses. Filled shapes inherit the text color.

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const RAISED_HAND = 'M6.8 11.5V6a1.6 1.6 0 0 1 3.2 0V3.8a1.6 1.6 0 0 1 3.2 0V5a1.6 1.6 0 0 1 3.2 0v2a1.6 1.6 0 0 1 3.2 0v8c0 4-2.8 7-6.8 7-3 0-4.8-1.2-6.2-3.2L2.7 14.2a1.7 1.7 0 0 1 2.6-2.1z';
const POINTING_HAND = 'M10 2.5a1.8 1.8 0 0 1 1.8 1.8V11l5.6 1a3 3 0 0 1 2.4 3.4l-.7 4.1a3 3 0 0 1-3 2.5h-4.6a3 3 0 0 1-2.3-1.1L4.6 15.6a1.7 1.7 0 0 1 2.4-2.3l1.2 1V4.3A1.8 1.8 0 0 1 10 2.5z';

const PATHS: Record<string, ReactNode> = {
  // Card emblems
  pass_go: <path {...STROKE} strokeWidth={3} d="M13 5l7 7-7 7M4 12h15" />,
  debt_collector: (
    <>
      <circle cx="10" cy="7" r="4" />
      <path d="M2.5 21c0-4.4 3.4-7.5 7.5-7.5s7.5 3.1 7.5 7.5z" />
      <path {...STROKE} strokeWidth={2} d="M17.3 5.9a2.5 2.5 0 1 1 3.5 2.4c-.9.4-1.3 1-1.3 1.8" />
      <circle cx="19.5" cy="13" r="1.2" />
    </>
  ),
  its_my_birthday: (
    <>
      <path d="M3.5 15.2c1.4 1.3 2.8 1.3 4.2 0s2.9-1.3 4.3 0 2.9 1.3 4.3 0 2.8-1.3 4.2 0V20a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 20z" />
      <path d="M6 13.3V11a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 11v2.3c-1.3-.7-2.7-.6-3.900.3-1.400 1.100-2.800 1.100-4.200 0-1.200-.9-2.600-1-3.900-.3z" />
      <path {...STROKE} strokeWidth={1.8} d="M8.500 8V6M12 8V6M15.500 8V6" />
      <circle cx="8.500" cy="3.700" r="1.100" />
      <circle cx="12" cy="3.700" r="1.100" />
      <circle cx="15.500" cy="3.700" r="1.100" />
    </>
  ),
  sly_deal: <path d={POINTING_HAND} />,
  forced_deal: <path {...STROKE} d="M3 8h16M15 4l4 4-4 4M21 16H5M9 12l-4 4 4 4" />,
  deal_breaker: <path d="M13.500 2 4.500 13.500H11L9.500 22l10-12.500H13z" />,
  house: <path d="M12 3 2.500 11.500H5.500V21h5v-6h3v6h5v-9.500h3z" />,
  hotel: <path fillRule="evenodd" d="M11 21V4h10v17h-3v-3h-4v3zM13.500 7v2h2V7zm3 0v2h2V7zm-3 4v2h2v-2zm3 0v2h2v-2zM3 21V10l6-2.500V21zm2-8v2h2v-2z" />,
  shack: <path fillRule="evenodd" d="M12 4 2 13h3v7h14v-7h3zM10 20v-5h4v5z" />,
  go_again: <path {...STROKE} strokeWidth={2.800} d="M20 12a8 8 0 1 1-2.600-5.900L20 8M20 3v5h-5" />,
  forced_debt: <path d="M2 8.500A2.500 2.500 0 0 1 4.500 6h15A2.500 2.500 0 0 1 22 8.500V9H2zM2 12h20v4.500a2.500 2.500 0 0 1-2.500 2.500h-15A2.500 2.500 0 0 1 2 16.500z" />,
  heist: (
    <>
      <rect x="5" y="11" width="14" height="10.500" rx="2.200" />
      <path {...STROKE} d="M8 11V7a4 4 0 0 1 7.600-1.700" />
    </>
  ),
  market_crash: <path {...STROKE} d="M3 3v18h18M6.500 7l4.500 5 3-3 5 6M19 10.500V15h-4.500" />,
  repossession: (
    <>
      <path d="M2 6h12v10.500H2zM15 9h3.800L22 13v3.500h-7z" />
      <circle cx="6.500" cy="18" r="2.200" />
      <circle cx="17.500" cy="18" r="2.200" />
    </>
  ),
  super_sly_deal: (
    <>
      <path d={RAISED_HAND} transform="rotate(-14 12 13) translate(0 1)" />
      <path d="M20.500 1.500l.7 1.800 1.800.7-1.800.7-.7 1.800-.7-1.800L18 4l1.800-.7z" />
    </>
  ),
  tax_collector: (
    <>
      <path {...STROKE} strokeWidth={2.800} d="M19 5 5 19" />
      <circle {...STROKE} cx="7" cy="7" r="2.800" />
      <circle {...STROKE} cx="17" cy="17" r="2.800" />
    </>
  ),
  tough_luck: (
    <>
      <path d="M7 14.500a4.500 4.500 0 0 1-.5-9A6 6 0 0 1 18 6.700a4 4 0 0 1 0 7.800h-3.300l1-2.200h-3.800l-2.200 2.200z" />
      <path d="M12.500 13.500 9 19h2.700l-1 4 4.300-6.200h-2.800l1.300-3.300z" />
    </>
  ),
  unfair_trade: (
    <>
      <path {...STROKE} strokeWidth={2} d="M12 3v18M7 21h10M5 6h14" />
      <path d="M5 6l-3.200 7.200a3.500 3.500 0 0 0 6.400 0zM19 6l-3.200 7.200a3.500 3.500 0 0 0 6.400 0z" />
    </>
  ),
  yoink: <path d={POINTING_HAND} transform="rotate(-90 12 12)" />,
  just_say_no: <path d={RAISED_HAND} />,
  star: <path d="M12 2.500l2.900 6.200 6.800.8-5 4.600 1.300 6.700-6-3.300-6 3.300 1.300-6.700-5-4.600 6.800-.8z" />,

  // Interface
  sparkles: <path d="M10 3l1.900 5.100L17 10l-5.100 1.900L10 17l-1.900-5.100L3 10l5.100-1.900zM18.500 14l1 2.500 2.500 1-2.500 1-1 2.500-1-2.500-2.500-1 2.500-1z" />,
  menu: <path {...STROKE} d="M4 7h16M4 12h16M4 17h16" />,
  back: <path {...STROKE} d="M15 5l-7 7 7 7" />,
  chevron: <path {...STROKE} d="M9 5l7 7-7 7" />,
  close: <path {...STROKE} d="M6 6l12 12M18 6 6 18" />,
  draw: <path {...STROKE} d="M12 3v12M6.500 10l5.500 5.500 5.500-5.500M5 20.500h14" />,
  check: <path {...STROKE} strokeWidth={3} d="M4.500 13l5 5L19.500 7" />,
  undo: <path {...STROKE} d="M9 5 4 10l5 5M4 10h10a5.500 5.500 0 0 1 0 11h-3" />,
  reset: <path {...STROKE} d="M4 12a8 8 0 1 0 2.600-5.900L4 8M4 3v5h5" />,
  bulb: <path d="M12 2a7 7 0 0 0-4.200 12.600c.7.600 1.200 1.300 1.200 2.400h6c0-1.100.5-1.800 1.200-2.400A7 7 0 0 0 12 2zM9.300 18.500h5.400v1.200a1.300 1.300 0 0 1-1.300 1.300h-2.800a1.300 1.300 0 0 1-1.300-1.300z" />,
  eye: <path fillRule="evenodd" d="M12 5c5 0 8.800 3.500 10.500 7-1.700 3.500-5.500 7-10.500 7S3.200 15.500 1.500 12C3.200 8.500 7 5 12 5zm0 3.500a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7z" />,
  eyeOff: <path {...STROKE} d="M3 3l18 18M10 5.200A10 10 0 0 1 22 12a14 14 0 0 1-2.800 3.800M6 7a14 14 0 0 0-4 5c1.700 3.500 5.500 7 10 7a9.500 9.500 0 0 0 4.500-1.200M10 10a3 3 0 0 0 4 4" />,
  trophy: <path d="M7 3h10v2h4v3a4 4 0 0 1-4 4h-.4a5 5 0 0 1-3.600 2.900V18h3v3H8v-3h3v-3.100A5 5 0 0 1 7.400 12H7a4 4 0 0 1-4-4V5h4zm0 4H5v1a2 2 0 0 0 2 2zm10 0v3a2 2 0 0 0 2-2V7z" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.800" />
      <path d="M2 20c0-3.900 3.100-6.500 7-6.500s7 2.600 7 6.500z" />
      <circle cx="17.500" cy="9" r="2.900" />
      <path d="M17.500 13.500c2.700 0 4.500 2.100 4.500 5H18c0-1.800-.6-3.400-1.800-4.700.4-.2.800-.3 1.300-.3z" />
    </>
  ),
  bot: <path fillRule="evenodd" d="M9 2v2.500h2V2h2v2.500h2V2h2v2.500A2.500 2.500 0 0 1 19.500 7v2H22v2h-2.500v2H22v2h-2.500v2a2.500 2.500 0 0 1-2.500 2.500V22h-2v-2.500h-2V22h-2v-2.500H9V22H7v-2.500A2.500 2.500 0 0 1 4.500 17v-2H2v-2h2.500v-2H2V9h2.500V7A2.500 2.500 0 0 1 7 4.500V2zm0 7a.8.8 0 0 0-.8.8v4.400c0 .4.400.8.800.8h6c.4 0 .8-.4.8-.8V9.800A.8.8 0 0 0 15 9z" />,
  globe: <path {...STROKE} strokeWidth={2} d="M12 2.500a9.500 9.500 0 1 0 0 19 9.500 9.500 0 0 0 0-19zM2.500 12h19M12 2.500c3 2.800 4 6 4 9.500s-1 6.700-4 9.500c-3-2.800-4-6-4-9.500s1-6.700 4-9.500z" />,
  stack: <path d="M7 3h10a1.500 1.500 0 0 1 1.500 1.500H5.500A1.500 1.500 0 0 1 7 3zM5 6h14a1.500 1.500 0 0 1 1.500 1.500H3.500A1.500 1.500 0 0 1 5 6zM4 9h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />,
  chart: <path d="M3 13h4.500v8H3zM9.800 3h4.500v18H9.800zM16.500 8H21v13h-4.500z" />,
  book: <path d="M2 5c3-.9 6.500-.8 9 1v15c-2.500-1.800-6-1.900-9-1zM22 5c-3-.9-6.500-.8-9 1v15c2.500-1.800 6-1.900 9-1z" />,
  gear: <path fillRule="evenodd" d="M10 2h4l.6 2.700 1.700.7 2.300-1.500 2.800 2.800-1.500 2.300.7 1.700 2.700.6v4l-2.700.6-.7 1.700 1.500 2.300-2.800 2.800-2.300-1.500-1.700.7L14 22h-4l-.6-2.700-1.700-.7-2.300 1.500-2.800-2.800 1.500-2.300-.7-1.700L1 14v-4l2.700-.6.7-1.700-1.500-2.300 2.800-2.800 2.300 1.500 1.700-.7zm2 6.500a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7z" />,
  play: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.500 7.500l7.500 4.500-7.500 4.500z" fillRule="evenodd" />,
  pause: <path d="M6 4h4.500v16H6zM13.500 4H18v16h-4.500z" />,
  playFill: <path d="M6 3.500v17a1 1 0 0 0 1.500.9l14-8.500a1 1 0 0 0 0-1.700l-14-8.500A1 1 0 0 0 6 3.500z" />,
  clock: <path {...STROKE} strokeWidth={2} d="M12 2.500a9.500 9.500 0 1 0 0 19 9.500 9.500 0 0 0 0-19zM12 6.500V12l-3.500 2.500" />,
  archive: <path fillRule="evenodd" d="M3.500 3h17A1.500 1.500 0 0 1 22 4.500V8H2V4.500A1.500 1.500 0 0 1 3.500 3zM3 9.500h18V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm6 3v2h6v-2z" />,
  calendar: <path fillRule="evenodd" d="M7 2h2v2h6V2h2v2h2.500A2.500 2.500 0 0 1 22 6.500v13a2.500 2.500 0 0 1-2.500 2.500h-15A2.500 2.500 0 0 1 2 19.500v-13A2.500 2.500 0 0 1 4.500 4H7zM4 9.500v10a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-10z" />,
  seal: <path fillRule="evenodd" d="M12 1.500l2.800 2 3.400-.3 1.300 3.200 2.900 1.800-.9 3.300.9 3.300-2.900 1.800-1.300 3.200-3.400-.3-2.800 2-2.800-2-3.400.3-1.300-3.200L1.600 14.800l.9-3.300-.9-3.300 2.900-1.800 1.300-3.200 3.400.3zm4.400 7L10.800 14 7.900 11.300l-1.500 1.500 4.400 4.200 7.100-7z" />,
  starOutline: <path {...STROKE} strokeWidth={2} d="M12 3.500l2.600 5.600 6.100.7-4.500 4.100 1.200 6-5.400-3-5.400 3 1.200-6-4.500-4.100 6.100-.7z" />,
  banknote: <path fillRule="evenodd" d="M2 6h20v12H2zm10 2.800a3.200 3.200 0 1 0 0 6.400 3.200 3.200 0 0 0 0-6.400z" />,
  cards: <path d="M9 3h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-1V8a3 3 0 0 0-3-3H7a2 2 0 0 1 2-2zM6 7h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />,
  wifiOff: <path {...STROKE} strokeWidth={2.200} d="M3 3l18 18M8.500 15.500a5 5 0 0 1 7 0M5 12a10 10 0 0 1 4-2.500M19 12a10 10 0 0 0-5.500-2.900M2 8.500A14 14 0 0 1 6.500 5.800M22 8.500A15 15 0 0 0 10 4.500M12 19.500h.01" />,
  info: <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.300 5.500h2.600v2.600h-2.600zm0 4.200h2.600v5.800h-2.600z" />,
  hourglass: <path d="M6 2h12v2h-1v3.500c0 1.600-1 3.100-2.500 4.500 1.500 1.400 2.500 2.900 2.500 4.500V20h1v2H6v-2h1v-3.500c0-1.600 1-3.100 2.500-4.500C8 10.600 7 9.100 7 7.500V4H6z" />,
  tap: <path d={POINTING_HAND} />,
  dollar: <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 3.500h2V7c1.700.3 3 1.500 3 3.200h-2.200c0-.7-.7-1.200-1.800-1.200s-1.800.500-1.800 1.200c0 .800.700 1.100 2.300 1.500 2.200.5 3.700 1.300 3.700 3.200 0 1.700-1.300 2.900-3.200 3.200v1.400h-2v-1.400c-1.900-.3-3.200-1.600-3.200-3.300h2.200c0 .9.800 1.400 2 1.400s2-.500 2-1.300c0-.800-.800-1.100-2.400-1.500-2-.5-3.600-1.200-3.600-3.200 0-1.600 1.200-2.800 3-3.100z" />,
  trash: <path d="M9 2h6l1 2h5v2.500H3V4h5zM5 8h14l-1.200 14H6.200z" />,
  alert: <path fillRule="evenodd" d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-5 5v-5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm6.700 2.500V11h2.600V5.500zm0 6.800v2.400h2.600v-2.400z" />,
  flag: <path d="M5 2h2v1h14l-3 5 3 5H7v9H5z" />,
  trend: <path {...STROKE} d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  share: <path {...STROKE} d="M12 15V3M7 8l5-5 5 5M5 13v8h14v-8" />,
  save: <path {...STROKE} d="M12 3v12M7 10l5 5 5-5M4 21h16" />,
  spade: <path d="M12 2c3 4 8 7 8 12a4.500 4.500 0 0 1-7 3.700l1 4.300H10l1-4.300A4.500 4.500 0 0 1 4 14c0-5 5-8 8-12z" />,
  list: <path {...STROKE} d="M8 6h13M8 12h13M8 18h13M3.500 6h.01M3.500 12h.01M3.500 18h.01" />,
  refresh: <path {...STROKE} d="M20 12a8 8 0 1 1-2.600-5.900L20 8M20 3v5h-5" />,
};

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.star}
    </svg>
  );
}
