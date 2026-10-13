import { BrowserWindow, ipcMain, screen } from "electron";
import { BB_DESKTOP_SET_WINDOW_WIDTH_CHANNEL } from "./desktop-window-command-ipc.js";

export type DesktopWindowWidthResult = {
  /** The width before this call, so the caller can restore it. */
  previousWidth: number;
  width: number;
};

/** Keep the width between the window minimum and the display work area. */
export function clampWindowWidth(
  requested: number,
  minimumWidth: number,
  workAreaWidth: number,
): number {
  const floor = Math.max(1, Math.round(minimumWidth));
  const ceiling = Math.max(floor, Math.round(workAreaWidth));
  return Math.min(ceiling, Math.max(floor, Math.round(requested)));
}

/**
 * Let an application window change its own width. Height and position stay.
 * A full-screen or maximized window keeps its size, and the call returns null.
 */
export function registerDesktopWindowSizeIpc(
  applicationWindowWebContentsIds: ReadonlySet<number>,
): void {
  ipcMain.handle(
    BB_DESKTOP_SET_WINDOW_WIDTH_CHANNEL,
    (event, width: unknown): DesktopWindowWidthResult | null => {
      if (!applicationWindowWebContentsIds.has(event.sender.id)) return null;
      if (typeof width !== "number" || !Number.isFinite(width)) return null;
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      if (browserWindow === null || browserWindow.isDestroyed()) return null;
      if (browserWindow.isFullScreen() || browserWindow.isMaximized()) {
        return null;
      }
      const bounds = browserWindow.getBounds();
      const [minimumWidth = 0] = browserWindow.getMinimumSize();
      const workArea = screen.getDisplayMatching(bounds).workArea;
      const next = clampWindowWidth(width, minimumWidth, workArea.width);
      // Keep the window on the display when it grows past the right edge.
      const maxX = workArea.x + workArea.width - next;
      const x = Math.max(workArea.x, Math.min(bounds.x, maxX));
      browserWindow.setBounds({ ...bounds, x, width: next }, true);
      return { previousWidth: bounds.width, width: next };
    },
  );
}
