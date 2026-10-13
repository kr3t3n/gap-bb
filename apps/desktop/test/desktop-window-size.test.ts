import { beforeEach, describe, expect, it, vi } from "vitest";
import { BB_DESKTOP_SET_WINDOW_WIDTH_CHANNEL } from "../src/desktop-window-command-ipc.js";
import {
  clampWindowWidth,
  registerDesktopWindowSizeIpc,
} from "../src/desktop-window-size.js";

type Handler = (event: { sender: { id: number } }, width: unknown) => unknown;

const mock = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const window = {
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 1200, y: 40, width: 1400, height: 900 })),
    getMinimumSize: vi.fn(() => [0, 0]),
    setBounds: vi.fn(),
  };
  return {
    handlers,
    window,
    fromWebContents: vi.fn((_sender: { id: number }) => window),
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 25, width: 2560, height: 1415 },
    })),
  };
});

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: mock.fromWebContents },
  ipcMain: { handle: mock.handle },
  screen: { getDisplayMatching: mock.getDisplayMatching },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.window.isFullScreen.mockReturnValue(false);
  mock.window.isMaximized.mockReturnValue(false);
  mock.fromWebContents.mockReturnValue(mock.window);
  registerDesktopWindowSizeIpc(new Set([42]));
});

function request(id: number, width: unknown) {
  return mock.handlers.get(BB_DESKTOP_SET_WINDOW_WIDTH_CHANNEL)?.(
    { sender: { id } },
    width,
  );
}

describe("desktop window width", () => {
  it("narrows the sending window and reports the old width", () => {
    expect(request(42, 360)).toEqual({ previousWidth: 1400, width: 360 });
    expect(mock.window.setBounds).toHaveBeenCalledWith(
      { x: 1200, y: 40, width: 360, height: 900 },
      true,
    );
  });

  it("moves a widening window left so it stays on the display", () => {
    mock.window.getBounds.mockReturnValueOnce({
      x: 2200,
      y: 40,
      width: 360,
      height: 900,
    });
    expect(request(42, 1400)).toEqual({ previousWidth: 360, width: 1400 });
    expect(mock.window.setBounds).toHaveBeenCalledWith(
      { x: 1160, y: 40, width: 1400, height: 900 },
      true,
    );
  });

  it("ignores full-screen windows, other senders and bad widths", () => {
    expect(request(7, 360)).toBeNull();
    expect(request(42, "360")).toBeNull();
    mock.window.isFullScreen.mockReturnValue(true);
    expect(request(42, 360)).toBeNull();
    expect(mock.window.setBounds).not.toHaveBeenCalled();
  });

  it("clamps to the minimum and the work area", () => {
    expect(clampWindowWidth(100, 320, 2560)).toBe(320);
    expect(clampWindowWidth(5000, 0, 2560)).toBe(2560);
  });
});
