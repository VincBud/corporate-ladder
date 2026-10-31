import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M3.5 14.5h17M9.5 4v16" />
    </Icon>
  );
}

export function LadderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3v18M17 3v18M7 7.5h10M7 12h10M7 16.5h10" />
    </Icon>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H5.5a2 2 0 0 0 2 4H8M16 6h2.5a2 2 0 0 1-2 4H16M12 13v4M8.5 20h7M10 17h4" />
    </Icon>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 20.5h15M6.5 20.5V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15M14.5 9.5h3a1 1 0 0 1 1 1v10" />
      <path d="M9 8h3M9 11.5h3M9 15h3M10.5 20.5v-2.5" />
    </Icon>
  );
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17M11 12.5v1.5h2v-1.5" />
    </Icon>
  );
}

export function IdBadgeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
      <circle cx="12" cy="10.5" r="2.5" />
      <path d="M8.5 16.5c.8-1.5 2-2.25 3.5-2.25s2.7.75 3.5 2.25M10 3.5V5.5h4V3.5" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

export function MinimizeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 12h12" />
    </Icon>
  );
}

export function MaximizeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
    </Icon>
  );
}

export function RestoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="8.5" width="10.5" height="10.5" rx="1.5" />
      <path d="M8.5 8.5v-2A1.5 1.5 0 0 1 10 5h7.5A1.5 1.5 0 0 1 19 6.5V14a1.5 1.5 0 0 1-1.5 1.5h-2" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function WifiIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.5a8 8 0 0 1 11 0M9.5 15.5a4 4 0 0 1 5 0" />
      <circle cx="12" cy="18.5" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function BatteryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="7.5" width="16" height="9" rx="2" />
      <path d="M21 10.5v3" />
      <rect x="5" y="9.5" width="4.5" height="5" rx="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function PowerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v8" />
      <path d="M7 6.5a7 7 0 1 0 10 0" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5Z" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m14.5 6-6 6 6 6" />
    </Icon>
  );
}
