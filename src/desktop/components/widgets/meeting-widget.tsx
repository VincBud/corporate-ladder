"use client";

import { useState } from "react";
import { NEXT_MEETING } from "../../desktop-content";
import { Widget } from "./widget";

export function MeetingWidget({ className }: { className?: string }) {
  const [declined, setDeclined] = useState(false);

  return (
    <Widget id="widget-meeting" label="Up next · Today" title={NEXT_MEETING.title} className={className}>
      <div className="mt-2 border-l-2 border-accent pl-2.5">
        <p className="text-xs tabular-nums">{NEXT_MEETING.time}</p>
        <p className="text-[11px] text-fg-muted">{NEXT_MEETING.location}</p>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-fg-subtle">
          {NEXT_MEETING.attendees} attendees · {NEXT_MEETING.agendaItems} agenda items
        </span>
        <button
          type="button"
          disabled={declined}
          onClick={() => setDeclined(true)}
          aria-label={`Decline ${NEXT_MEETING.title}`}
          className="rounded px-1 font-medium text-accent hover:underline disabled:text-fg-subtle disabled:no-underline"
        >
          {declined ? "Pending" : "Decline"}
        </button>
      </div>
      <p role="status" className={declined ? "mt-2 text-[11px] leading-snug text-warning" : "sr-only"}>
        {declined && "Declining requires a pre-meeting. It has been added to your calendar."}
      </p>
    </Widget>
  );
}
