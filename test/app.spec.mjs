import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THREE_ROOT = path.resolve(__dirname, '../node_modules/three');

const CONTENT_TYPES = { '.js': 'application/javascript', '.mjs': 'application/javascript' };

/**
 * These specs exercise the REAL shipped index.html byte-for-byte — no test
 * fork, no build step. Two external boundaries get intercepted at the
 * network layer only, so the test runs offline / in CI with no live
 * internet access:
 *
 *  1. three@0.185.1 (+ examples/jsm addons) from jsdelivr -> served from
 *     the local npm copy already in node_modules/three. Real Three.js,
 *     just fetched locally instead of over the network.
 *
 *  2. @mediapipe/tasks-vision from jsdelivr -> a tiny stub exposing the
 *     same HandLandmarker/FilesetResolver shape handTracking.js expects.
 *     MediaPipe's actual WASM hand-tracking model is Google-hosted and
 *     cannot meaningfully run against a synthetic fake-camera pattern
 *     anyway (there's no real hand in the test video), so the stub
 *     reports "zero hands visible" every frame - which is exactly what a
 *     real browser sees before a hand enters frame. That's enough to
 *     verify the full boot sequence: camera permission -> model init ->
 *     RUNNING status -> render loop, without depending on Google's CDN.
 *
 * Run against the real deployed app with real internet access (drop the
 * two `page.route` blocks, or just run in a browser by hand), this same
 * flow additionally proves out live hand detection.
 */
async function mockExternalBoundaries(page) {
  // ---- three.js: serve the local npm copy for any jsdelivr/three@version/* URL ----
  await page.route('https://cdn.jsdelivr.net/npm/three@*/**', async (route) => {
    const url = new URL(route.request().url());
    const afterVersion = url.pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const filePath = path.join(THREE_ROOT, afterVersion);
    try {
      const body = await readFile(filePath);
      const ext = path.extname(filePath);
      await route.fulfill({ status: 200, contentType: CONTENT_TYPES[ext] || 'application/octet-stream', body });
    } catch {
      await route.fulfill({ status: 404, body: `not found locally: ${afterVersion}` });
    }
  });

  // ---- MediaPipe: replace with a minimal stub (see docstring above) ----
  await page.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@*/vision_bundle.mjs', async (route) => {
    const stub = `
      export class FilesetResolver { static async forVisionTasks() { return {}; } }
      export class HandLandmarker {
        static async createFromOptions() {
          return { detectForVideo: () => ({ landmarks: [] }), close: () => {} };
        }
      }
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });

  // ---- Google Fonts: not needed for a functional test. Fulfilling (not
  // aborting) an empty stylesheet keeps this a clean 200 instead of a
  // console-visible net::ERR_FAILED - the CSS font-stack's system-font
  // fallbacks apply either way, this just keeps the "no console errors"
  // assertion honest about *application* errors specifically. ----
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* fonts stubbed for test */' })
  );
}

test.beforeEach(async ({ page }) => {
  await mockExternalBoundaries(page);
});

test('boots to the welcome screen with a live WebGL scene behind it and no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');

  await expect(page.locator('#loading-overlay')).toBeVisible();
  await expect(page.locator('#start-button')).toBeVisible();
  await expect(page.locator('#scene-canvas')).toBeVisible();

  // Scene/planet construction runs synchronously at module load, before any
  // camera interaction - so if this is clean, InstancedMesh + bloom +
  // starfield all built without throwing.
  expect(errors, `console/page errors before any interaction:\n${errors.join('\n')}`).toEqual([]);
});

test('legend panel toggles open and closed and keeps aria in sync', async ({ page }) => {
  test.slow(); // see note on software-rendered WebGL timing in the start-flow test below

  await page.goto('/');
  // The welcome modal intentionally blocks the rest of the UI (by design -
  // it's a modal), so dismiss it first, same as a real visitor would.
  await page.locator('#start-button').click();
  await expect(page.locator('#loading-overlay')).toBeHidden({ timeout: 60_000 });

  const toggle = page.locator('#legend-toggle');
  const legend = page.locator('#legend');

  await expect(legend).toHaveClass(/collapsed/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(legend).not.toHaveClass(/collapsed/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();
  await expect(legend).toHaveClass(/collapsed/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('start flow: camera permission -> mocked model load -> RUNNING, rendering the planet', async ({ page }) => {
  // Software-rendered WebGL (no GPU passthrough, common in headless/CI
  // sandboxes) makes a 6000-instance bloom-lit scene render far slower
  // than on real hardware - this test's generous timeout reflects that
  // testing environment, not expected real-world performance.
  test.slow();

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await page.locator('#start-button').click();

  await expect(page.locator('#loading-overlay')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#mode-badge')).toHaveAttribute('data-mode', 'idle');
  await expect(page.locator('#mode-label')).toHaveText('در انتظار دست');

  // Screenshot for a human sanity check of the actual planet/starfield/HUD
  // composition (saved even under software rendering, just for layout/
  // color confirmation rather than a frame-rate judgment).
  await page.screenshot({ path: 'test-results/running-state.png' });

  expect(errors, `console/page errors during start flow:\n${errors.join('\n')}`).toEqual([]);
});
