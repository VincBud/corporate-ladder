/** System flavor text for the notification center. Not user data. */
export interface SystemNotification {
  id: string;
  source: string;
  message: string;
  age: string;
}

export const SYSTEM_NOTIFICATIONS: readonly SystemNotification[] = [
  { id: "it-password", source: "IT Service Desk", message: "Your password expires in 3 days. And every 3 days after that.", age: "2m" },
  { id: "calendar-sync", source: "Calendar", message: "“Quick sync” (90 min) starts in 5 minutes.", age: "14m" },
  { id: "hr-fun", source: "People & Culture", message: "Mandatory fun is scheduled for Friday at 4:45 PM. Attendance is tracked.", age: "1h" },
];
