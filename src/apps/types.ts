import type { ComponentType } from "react";
import type { IconProps } from "@/components/icons";
import type { WindowSizing } from "@/desktop/window-manager";
import type { AppId } from "@/types/app";
import type { Employee } from "@/types/employee";

/** Props every desktop application receives from the shell. */
export interface AppProps {
  employee: Employee;
  openApp: (appId: AppId) => void;
  /**
   * Ask the shell to confirm before this app's window closes, e.g. during an
   * active game round. Pass null to allow closing without confirmation.
   */
  setCloseWarning: (message: string | null) => void;
}

export interface AppDefinition {
  id: AppId;
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
  /** Tailwind gradient classes for the app tile. */
  tint: string;
  /** Default and minimum window dimensions. */
  window: WindowSizing;
  component: ComponentType<AppProps>;
}
