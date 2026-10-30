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

export interface Rect extends Point, Size {}

export interface WindowSizing {
  /** Fixed size, or a fraction of the workspace in each dimension. */
  initial: Size | { fraction: number };
  /** Smallest size the user can resize to. */
  min: Size;
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface WindowState extends Rect {
  appId: AppId;
  /** Monotonic open order; keeps taskbar and DOM order stable while z-order changes. */
  openSeq: number;
  minSize: Size;
  minimized: boolean;
  maximized: boolean;
}

export interface WindowManagerState {
  /** Z-order, back to front. */
  windows: WindowState[];
  nextSeq: number;
}

export type WindowAction =
  | { type: "open"; appId: AppId; sizing: WindowSizing; bounds: Size }
  | { type: "close"; appId: AppId }
  | { type: "focus"; appId: AppId }
  | { type: "minimize"; appId: AppId }
  | { type: "toggleMaximize"; appId: AppId }
  | { type: "move"; appId: AppId; position: Point }
  | { type: "resize"; appId: AppId; rect: Rect }
  | { type: "fitToBounds"; bounds: Size };

export const initialWindowManagerState: WindowManagerState = { windows: [], nextSeq: 1 };

/** Height of the title bar, which must always stay inside the workspace. */
export const TITLE_BAR_HEIGHT = 40;
/** Width of a window's right end (where its controls live) that must stay visible. */
const MIN_VISIBLE_WIDTH = 160;
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

/** Initial window size: honors the app's preference, never exceeds the workspace. */
export function resolveInitialSize(sizing: WindowSizing, bounds: Size): Size {
  const preferred =
    "fraction" in sizing.initial
      ? {
          width: Math.round(bounds.width * sizing.initial.fraction),
          height: Math.round(bounds.height * sizing.initial.fraction),
        }
      : sizing.initial;
  const available = {
    width: Math.max(0, bounds.width - EDGE_MARGIN * 2),
    height: Math.max(0, bounds.height - EDGE_MARGIN * 2),
  };
  return {
    width: Math.min(Math.max(preferred.width, sizing.min.width), available.width),
    height: Math.min(Math.max(preferred.height, sizing.min.height), available.height),
  };
}

/**
 * Keeps the title bar inside the workspace and the window controls on screen.
 * Windows may slide off the left edge, but never off the right or top.
 */
export function clampWindowPosition(position: Point, size: Size, bounds: Size): Point {
  return {
    x: clamp(position.x, Math.min(0, MIN_VISIBLE_WIDTH - size.width), bounds.width - size.width),
    y: clamp(position.y, 0, bounds.height - TITLE_BAR_HEIGHT),
  };
}

/** Applies a pointer delta to one edge or corner, respecting minimum size and workspace bounds. */
export function resizeRect(origin: Rect, edge: ResizeEdge, delta: Point, min: Size, bounds: Size): Rect {
  let { x, y, width, height } = origin;

  if (edge.includes("e")) {
    width = clamp(origin.width + delta.x, min.width, Math.max(bounds.width - origin.x, origin.width));
  }
  if (edge.includes("w")) {
    const right = origin.x + origin.width;
    x = clamp(origin.x + delta.x, Math.min(0, origin.x), right - min.width);
    width = right - x;
  }
  if (edge.includes("s")) {
    height = clamp(origin.height + delta.y, min.height, Math.max(bounds.height - origin.y, origin.height));
  }
  if (edge.includes("n")) {
    const bottom = origin.y + origin.height;
    y = clamp(origin.y + delta.y, 0, bottom - min.height);
    height = bottom - y;
  }

  return { x, y, width, height };
}

/** Shrinks and repositions a window so it stays usable after the workspace changes size. */
function fitWindow(win: WindowState, bounds: Size): WindowState {
  const width = Math.min(win.width, bounds.width);
  const height = Math.min(win.height, bounds.height);
  const { x, y } = clampWindowPosition(win, { width, height }, bounds);
  if (x === win.x && y === win.y && width === win.width && height === win.height) return win;
  return { ...win, x, y, width, height };
}

export function windowManagerReducer(state: WindowManagerState, action: WindowAction): WindowManagerState {
  switch (action.type) {
    case "open": {
      if (state.windows.some((w) => w.appId === action.appId)) {
        return bringToFront(state, action.appId, { minimized: false });
      }
      const { bounds, sizing } = action;
      const { width, height } = resolveInitialSize(sizing, bounds);
      const offset = (state.windows.length % CASCADE_SLOTS) * CASCADE_STEP;
      const window: WindowState = {
        appId: action.appId,
        openSeq: state.nextSeq,
        width,
        height,
        minSize: sizing.min,
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
    case "resize":
      return updateWindow(state, action.appId, action.rect);
    case "fitToBounds": {
      const windows = state.windows.map((w) => fitWindow(w, action.bounds));
      return windows.every((w, i) => w === state.windows[i]) ? state : { ...state, windows };
    }
  }
}

/** The topmost visible window, if any. */
export function selectFocusedAppId(state: WindowManagerState): AppId | null {
  for (let i = state.windows.length - 1; i >= 0; i--) {
    if (!state.windows[i].minimized) return state.windows[i].appId;
  }
  return null;
}
