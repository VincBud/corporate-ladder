import type { AppId } from "@/types/app";

/**
 * Pure window-management state. Viewport measurements are passed in by the
 * caller so this module stays deterministic and testable.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface WindowState extends Point, Size {
  appId: AppId;
  /** Monotonic open order; keeps taskbar and DOM order stable while z-order changes. */
  openSeq: number;
  minimized: boolean;
  maximized: boolean;
}

export interface WindowManagerState {
  /** Z-order, back to front. */
  windows: WindowState[];
  nextSeq: number;
}

export type WindowAction =
  | { type: "open"; appId: AppId; size: Size; bounds: Size }
  | { type: "close"; appId: AppId }
  | { type: "focus"; appId: AppId }
  | { type: "minimize"; appId: AppId }
  | { type: "toggleMaximize"; appId: AppId }
  | { type: "move"; appId: AppId; position: Point };

export const initialWindowManagerState: WindowManagerState = { windows: [], nextSeq: 1 };

const EDGE_MARGIN = 16;
const CASCADE_STEP = 28;
const CASCADE_SLOTS = 6;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

function bringToFront(
  state: WindowManagerState,
  appId: AppId,
  patch: Partial<WindowState> = {},
): WindowManagerState {
  const target = state.windows.find((w) => w.appId === appId);
  if (!target) return state;
  return {
    ...state,
    windows: [...state.windows.filter((w) => w.appId !== appId), { ...target, ...patch }],
  };
}

function updateWindow(state: WindowManagerState, appId: AppId, patch: Partial<WindowState>): WindowManagerState {
  return {
    ...state,
    windows: state.windows.map((w) => (w.appId === appId ? { ...w, ...patch } : w)),
  };
}

export function windowManagerReducer(state: WindowManagerState, action: WindowAction): WindowManagerState {
  switch (action.type) {
    case "open": {
      if (state.windows.some((w) => w.appId === action.appId)) {
        return bringToFront(state, action.appId, { minimized: false });
      }
      const { bounds, size } = action;
      const width = Math.min(size.width, bounds.width - EDGE_MARGIN * 2);
      const height = Math.min(size.height, bounds.height - EDGE_MARGIN * 2);
      const offset = (state.windows.length % CASCADE_SLOTS) * CASCADE_STEP;
      const window: WindowState = {
        appId: action.appId,
        openSeq: state.nextSeq,
        width,
        height,
        x: clamp((bounds.width - width) / 2 + offset - CASCADE_STEP, EDGE_MARGIN, bounds.width - width - EDGE_MARGIN),
        y: clamp((bounds.height - height) / 2 + offset - CASCADE_STEP * 2, EDGE_MARGIN, bounds.height - height - EDGE_MARGIN),
        minimized: false,
        maximized: false,
      };
      return { windows: [...state.windows, window], nextSeq: state.nextSeq + 1 };
    }
    case "close":
      return { ...state, windows: state.windows.filter((w) => w.appId !== action.appId) };
    case "focus": {
      const top = state.windows.at(-1);
      if (top?.appId === action.appId && !top.minimized) return state;
      return bringToFront(state, action.appId, { minimized: false });
    }
    case "minimize":
      return updateWindow(state, action.appId, { minimized: true });
    case "toggleMaximize": {
      const target = state.windows.find((w) => w.appId === action.appId);
      return target ? bringToFront(state, action.appId, { maximized: !target.maximized, minimized: false }) : state;
    }
    case "move":
      return updateWindow(state, action.appId, { x: action.position.x, y: action.position.y });
  }
}

/** The topmost visible window, if any. */
export function selectFocusedAppId(state: WindowManagerState): AppId | null {
  for (let i = state.windows.length - 1; i >= 0; i--) {
    if (!state.windows[i].minimized) return state.windows[i].appId;
  }
  return null;
}

/** Keeps a dragged window's title bar reachable inside the workspace. */
export function clampWindowPosition(position: Point, size: Size, bounds: Size): Point {
  const grabMargin = 96;
  return {
    x: clamp(position.x, grabMargin - size.width, bounds.width - grabMargin),
    y: clamp(position.y, 0, bounds.height - 40),
  };
}
