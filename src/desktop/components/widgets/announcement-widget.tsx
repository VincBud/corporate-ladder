import { ANNOUNCEMENT } from "../../desktop-content";
import { Widget } from "./widget";

export function AnnouncementWidget({ className }: { className?: string }) {
  return (
    <Widget id="widget-announcement" label="Internal announcement" title={ANNOUNCEMENT.title} className={className}>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{ANNOUNCEMENT.body}</p>
      <p className="mt-2 text-[11px] text-fg-subtle">
        {ANNOUNCEMENT.source} · {ANNOUNCEMENT.posted}
      </p>
    </Widget>
  );
}
