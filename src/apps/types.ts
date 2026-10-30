import type { ComponentType } from "react";
import type { IconProps } from "@/components/icons";
import type { Size } from "@/desktop/window-manager";
import type { AppId } from "@/types/app";
import type { Employee } from "@/types/employee";

/** Props every desktop application receives from the shell. */
export interface AppProps {
  employee: Employee;
  openApp: (appId: AppId) => void;
}

export interface AppDefinition {
  id: AppId;
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
  /** Tailwind gradient classes for the app tile. */
  tint: string;
  defaultSize: Size;
  component: ComponentType<AppProps>;
}
