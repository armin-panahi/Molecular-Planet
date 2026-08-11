import * as THREE from 'three';
import { SceneSetup } from './sceneSetup.js';
import { MolecularPlanet } from './planet.js';
import { HandTracking, TRACKING_STATUS } from './handTracking.js';
import { InteractionController } from './interactionController.js';
import { UIController } from './ui.js';

// ---- DOM ------------------------------------------------------------

const dom = {
  canvas: document.getElementById('scene-canvas'),
  video: document.getElementById('video'),
  pip: document.getElementById('pip'),
  overlayCanvas: document.getElementById('overlay-canvas'),

  legendToggle: document.getElementById('legend-toggle'),
  legend: document.getElementById('legend'),

  modeBadge: document.getElementById('mode-badge'),
  modeIcon: document.getElementById('mode-icon'),
  modeLabel: document.getElementById('mode-label'),

  moleculePanel: document.getElementById('molecule-panel'),
  closePanelButton: document.getElementById('close-panel-button'),
  moleculeSwatch: document.getElementById('molecule-swatch'),
  moleculeFormula: document.getElementById('molecule-formula'),
  moleculeName: document.getElementById('molecule-name'),
  moleculeDescription: document.getElementById('molecule-description'),

  loadingOverlay: document.getElementById('loading-overlay'),
  startButton: document.getElementById('start-button'),
  statusSpinner: document.getElementById('status-spinner'),
  statusText: document.getElementById('status-text'),

  errorOverlay: document.getElementById('error-overlay'),
  errorText: document.getElementById('error-text'),
  retryButton: document.getElementById('retry-button'),
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- scene ------------------------------------------------------------

const sceneSetup = new SceneSetup(dom.canvas);
const planet = new MolecularPlanet({ count: 6000 });
sceneSetup.scene.add(planet.group);

// ---- ui ------------------------------------------------------------

const ui = new UIController(dom);
ui.showWelcome();

// Keep aria-expanded in sync without touching the tested UIController class.
dom.legendToggle.addEventListener('click', () => {
  const isOpen = !dom.legend.classList.contains('collapsed');
  dom.legendToggle.setAttribute('aria-expanded', String(isOpen));
  dom.legend.setAttribute('aria-hidden', String(!isOpen));
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!dom.legend.classList.contains('collapsed')) dom.legendToggle.click();
  ui.hideMoleculeInfo();
});

// ---- gesture -> scene wiring --------------------------------------------

let latestHandsLandmarks = [];
let latestHoverInfo = null;

const interactionController = new InteractionController({
  camera: sceneSetup.camera,
  planet,
  onModeChange: (mode) => ui.setMode(mode),
  onMoleculeSelected: (hit) => {
    ui.showMoleculeInfo(hit);
    dom.moleculePanel.setAttribute('aria-hidden', 'false');
  },
  onMoleculeHover: (hoverInfo) => {
    latestHoverInfo = hoverInfo;
  },
});

dom.closePanelButton.addEventListener('click', () => {
  dom.moleculePanel.setAttribute('aria-hidden', 'true');
});

// ---- webcam / MediaPipe --------------------------------------------------

function describeError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'دسترسی به دوربین رد شد. برای ادامه، اجازه‌ی دسترسی به وب‌کم را در تنظیمات مرورگر فعال کن و دوباره تلاش کن.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'هیچ وب‌کمی پیدا نشد. این تجربه برای تشخیص حرکت دست به یک دوربین نیاز دارد.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'دوربین در دسترس نیست. ممکن است برنامه‌ی دیگری در حال استفاده از آن باشد.';
  }
  return undefined; // fall back to UIController's default message
}

const handTracking = new HandTracking({
  videoElement: dom.video,
  numHands: 2,
  onResults: (handsLandmarks) => {
    latestHandsLandmarks = handsLandmarks;
    interactionController.update(handsLandmarks);
  },
  onStatusChange: (status) => {
    if (status !== TRACKING_STATUS.PAUSED) ui.setStatus(status);
  },
  onError: (err) => {
    console.error('[hand-tracking]', err);
    ui.showError(describeError(err));
  },
});

let starting = false;
async function beginExperience() {
  if (starting) return;
  starting = true;
  dom.startButton.disabled = true;
  try {
    await handTracking.start();
  } catch (err) {
    // already surfaced via onError
  } finally {
    starting = false;
    dom.startButton.disabled = false;
  }
}

ui.onStart(beginExperience);
ui.onRetry(beginExperience);

// ---- render loop --------------------------------------------------------

const timer = new THREE.Timer();
timer.connect(document); // avoids a large delta spike when the tab regains focus

function tick(timestamp) {
  timer.update(timestamp);
  const delta = timer.getDelta();
  if (!prefersReducedMotion) planet.update(delta);
  ui.drawHandOverlay(latestHandsLandmarks, latestHoverInfo);
  sceneSetup.render();
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
