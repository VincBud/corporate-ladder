import { OsLogo } from "@/components/brand/os-logo";
import { BRAND } from "@/config/brand";

export function Wallpaper() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 wallpaper-gradient" />
      <div className="absolute inset-0 wallpaper-grid" />
      <OsLogo className="absolute top-1/2 left-1/2 size-[26rem] -translate-x-1/2 -translate-y-1/2 text-accent opacity-[0.04]" />
      <div className="absolute bottom-17 left-5 hidden text-[11px] leading-relaxed text-fg-subtle/70 md:block">
        <p className="font-medium">
          {BRAND.osName} {BRAND.osEdition}
        </p>
        <p>Evaluation copy · Build {BRAND.osVersion}</p>
        <p>Activate Synergy to remove this watermark.</p>
      </div>
    </div>
  );
}
