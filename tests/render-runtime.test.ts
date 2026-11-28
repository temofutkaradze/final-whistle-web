import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const createBrowserRuntime = createRequire(import.meta.url)('../render/runtime/browser.js');
const createImageExport = createRequire(import.meta.url)('../render/runtime/image-export.js');

function fakeBrowser() {
  const listeners = new Map<string, () => void>();
  return {
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    disconnect: () => listeners.get('disconnected')?.(),
    newContext: vi.fn(async (_options: unknown) => ({ identity: Symbol('context') })),
    close: vi.fn(async () => {}),
  };
}

describe('extracted renderer lifecycle', () => {
  it('lazily shares one browser and exact existing context configuration', async () => {
    const browser = fakeBrowser(), launch = vi.fn(async () => browser);
    const runtime = createBrowserRuntime({ chromium: { launch } });
    expect(launch).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([runtime.getContext(), runtime.getContext()]);
    expect(first).toBe(second);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledExactlyOnceWith({
      viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2,
      acceptDownloads:false,serviceWorkers:'block',
    });
    await runtime.resetBrowser();
    await runtime.resetBrowser();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('recreates disconnected state without letting an old browser invalidate its replacement', async () => {
    const first = fakeBrowser(), replacement = fakeBrowser();
    const launch = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(replacement);
    const runtime = createBrowserRuntime({ chromium: { launch } });
    const oldContext = await runtime.getContext();
    first.disconnect();
    const context = await runtime.getContext();
    expect(context).not.toBe(oldContext);
    first.disconnect();
    expect(await runtime.getContext()).toBe(context);
    expect(launch).toHaveBeenCalledTimes(2);
    await runtime.resetBrowser();
  });

  it('clears rejected launch state so the next request can recover', async () => {
    const browser = fakeBrowser();
    const launch = vi.fn().mockRejectedValueOnce(new Error('launch unavailable')).mockResolvedValue(browser);
    const runtime = createBrowserRuntime({ chromium: { launch } });
    await expect(runtime.getContext()).rejects.toThrow('launch unavailable');
    expect(await runtime.getBrowser()).toBe(browser);
    await runtime.resetBrowser();
  });
});

it('passes native capture bytes through without resizing or re-encoding', async () => {
  const pixels = Buffer.from('mock lossless capture bytes');
  const send = vi.fn(async () => ({ data: pixels.toString('base64') }));
  const detach = vi.fn(async () => {});
  const context = { newCDPSession: vi.fn(async () => ({ send, detach })) };
  const sharp = vi.fn(() => ({ metadata: async () => ({ width: 2160, height: 2700 }) }));
  const exports = createImageExport({ sharp, FINAL_WIDTH: 1080, FINAL_HEIGHT: 1350,
    HIRES_WIDTH: 2160, HIRES_HEIGHT: 2700, JPEG_QUALITY: 97, GRAIN_SIGMA: 0 });
  const page = { screenshot: vi.fn() };
  expect(await exports.captureHiRes(page, context)).toEqual(pixels);
  expect(send).toHaveBeenCalledWith('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  expect(page.screenshot).not.toHaveBeenCalled();
  expect(detach).toHaveBeenCalledTimes(1);
});
