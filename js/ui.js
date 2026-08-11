import { MODE } from './interactionController.js';

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

const MODE_META = {
  [MODE.IDLE]: { label: 'در انتظار دست', icon: 'idle' },
  [MODE.ZOOM]: { label: 'بزرگ‌نمایی', icon: 'zoom' },
  [MODE.ROTATE]: { label: 'چرخش سیاره', icon: 'rotate' },
  [MODE.PAN]: { label: 'جابجایی سیاره', icon: 'pan' },
  [MODE.SELECT]: { label: 'انتخاب مولکول', icon: 'select' },
  [MODE.EXPLODE]: { label: 'پخش / جمع مولکول‌ها', icon: 'explode' },
};

const ICON_PATHS = {
  idle: '<circle cx="10" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  zoom: '<circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="12.3" y1="12.3" x2="17" y2="17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  rotate:
    '<path d="M4 10a6 6 0 1 1 2 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4 14v-3.5h3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  pan: '<path d="M10 2v16M2 10h16M5 5l-2.5 2.5L5 10M15 5l2.5 2.5L15 10M5 15l-2.5-2.5M15 15l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  select: '<circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="10" y1="1.5" x2="10" y2="5" stroke="currentColor" stroke-width="1.3"/><line x1="10" y1="15" x2="10" y2="18.5" stroke="currentColor" stroke-width="1.3"/><line x1="1.5" y1="10" x2="5" y2="10" stroke="currentColor" stroke-width="1.3"/><line x1="15" y1="10" x2="18.5" y2="10" stroke="currentColor" stroke-width="1.3"/>',
  explode:
    '<line x1="10" y1="1.5" x2="10" y2="6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="10" y1="14" x2="10" y2="18.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="1.5" y1="10" x2="6" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="14" y1="10" x2="18.5" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="4.2" y1="4.2" x2="7.3" y2="7.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12.7" y1="12.7" x2="15.8" y2="15.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="15.8" y1="4.2" x2="12.7" y2="7.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="7.3" y1="12.7" x2="4.2" y2="15.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
};

const STATUS_MESSAGES = {
  'requesting-camera': 'در حال درخواست دسترسی به دوربین…',
  'loading-model': 'در حال آماده‌سازی تشخیص حرکت دست…',
};

export class UIController {
  constructor(dom) {
    this.dom = dom; // object of element references, see main.js
    this._buildIconSprite();
    this.dom.retryButton?.addEventListener('click', () => this._retryHandler?.());
    this.dom.startButton?.addEventListener('click', () => this._startHandler?.());
    this.dom.closePanelButton?.addEventListener('click', () => this.hideMoleculeInfo());
    this.dom.legendToggle?.addEventListener('click', () => this.dom.legend.classList.toggle('collapsed'));
    this._resizeOverlayCanvas();
    window.addEventListener('resize', () => this._resizeOverlayCanvas());
  }

  onStart(handler) {
    this._startHandler = handler;
  }
  onRetry(handler) {
    this._retryHandler = handler;
  }

  _buildIconSprite() {
    this.dom.modeIcon.innerHTML = ICON_PATHS.idle;
  }

  // ---- status / permission screens -------------------------------------

  showWelcome() {
    this.dom.loadingOverlay.classList.remove('hidden');
    this.dom.errorOverlay.classList.add('hidden');
    this.dom.startButton.classList.remove('hidden');
    this.dom.statusSpinner.classList.add('hidden');
    this.dom.statusText.textContent = '';
  }

  setStatus(status) {
    if (status === 'running') {
      this.dom.loadingOverlay.classList.add('hidden');
      return;
    }
    this.dom.loadingOverlay.classList.remove('hidden');
    this.dom.errorOverlay.classList.add('hidden');
    this.dom.startButton.classList.add('hidden');
    this.dom.statusSpinner.classList.remove('hidden');
    this.dom.statusText.textContent = STATUS_MESSAGES[status] || '';
  }

  showError(message) {
    this.dom.loadingOverlay.classList.add('hidden');
    this.dom.errorOverlay.classList.remove('hidden');
    this.dom.errorText.textContent =
      message || 'دسترسی به دوربین ممکن نشد. لطفاً اجازهٔ دسترسی به وب‌کم را در مرورگر بررسی کنید و دوباره تلاش کنید.';
  }

  // ---- mode badge ---------------------------------------------------

  setMode(mode) {
    const meta = MODE_META[mode] || MODE_META[MODE.IDLE];
    this.dom.modeLabel.textContent = meta.label;
    this.dom.modeIcon.innerHTML = ICON_PATHS[meta.icon];
    this.dom.modeBadge.dataset.mode = mode;
  }

  // ---- molecule info panel -------------------------------------------

  showMoleculeInfo(hit) {
    const { type } = hit;
    this.dom.moleculeSwatch.style.background = `#${type.color.toString(16).padStart(6, '0')}`;
    this.dom.moleculeFormula.textContent = type.formula;
    this.dom.moleculeName.textContent = type.name;
    this.dom.moleculeDescription.textContent = type.description;
    this.dom.moleculePanel.classList.remove('hidden');
    this.dom.moleculePanel.classList.add('visible');
  }

  hideMoleculeInfo() {
    this.dom.moleculePanel.classList.remove('visible');
  }

  // ---- webcam preview + hand skeleton overlay -------------------------

  _resizeOverlayCanvas() {
    const rect = this.dom.pip.getBoundingClientRect();
    this.dom.overlayCanvas.width = rect.width * window.devicePixelRatio;
    this.dom.overlayCanvas.height = rect.height * window.devicePixelRatio;
  }

  /**
   * Draws a minimal teal/amber hand skeleton (never MediaPipe's default
   * red/green dots) mirrored to match the mirrored video preview, plus an
   * optional dwell-progress ring around the pointing fingertip.
   */
  drawHandOverlay(handsLandmarks, hoverInfo) {
    const ctx = this.dom.overlayCanvas.getContext('2d');
    const w = this.dom.overlayCanvas.width;
    const h = this.dom.overlayCanvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!handsLandmarks.length) return;

    for (const landmarks of handsLandmarks) {
      const pts = landmarks.map((p) => ({ x: (1 - p.x) * w, y: p.y * h }));

      ctx.strokeStyle = 'rgba(77, 217, 196, 0.85)';
      ctx.lineWidth = Math.max(1, w * 0.006);
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(232, 169, 77, 0.9)';
      const r = Math.max(1.5, w * 0.01);
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (hoverInfo && hoverInfo.dwellProgress != null && handsLandmarks[0]) {
      const tip = handsLandmarks[0][8];
      const cx = (1 - tip.x) * w;
      const cy = tip.y * h;
      const radius = w * 0.028;
      ctx.strokeStyle = 'rgba(232, 169, 77, 0.35)';
      ctx.lineWidth = w * 0.006;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#e8a94d';
      ctx.lineWidth = w * 0.008;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + hoverInfo.dwellProgress * Math.PI * 2);
      ctx.stroke();
    }
  }
}
