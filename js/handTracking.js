import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const TRACKING_STATUS = {
  IDLE: 'idle',
  REQUESTING_CAMERA: 'requesting-camera',
  LOADING_MODEL: 'loading-model',
  RUNNING: 'running',
  PAUSED: 'paused',
  ERROR: 'error',
};

/**
 * HandTracking
 * -----------------------------------------------------------------------
 * Wraps getUserMedia + MediaPipe's HandLandmarker (Tasks Vision) into a
 * small start/stop lifecycle that hands raw per-frame landmark arrays to
 * a callback. Everything gesture-related lives elsewhere (gestureRecognizer
 * / interactionController) - this module's only job is turning a webcam
 * into landmarks.
 */
export class HandTracking {
  constructor({ videoElement, numHands = 2, onResults, onStatusChange, onError }) {
    this.video = videoElement;
    this.numHands = numHands;
    this.onResults = onResults || (() => {});
    this.onStatusChange = onStatusChange || (() => {});
    this.onError = onError || (() => {});

    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this._rafId = null;
    this._lastVideoTime = -1;

    this._handleVisibility = this._handleVisibility.bind(this);
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('این مرورگر از دسترسی به وب‌کم پشتیبانی نمی‌کند.');
      this._fail(err);
      throw err;
    }

    try {
      this._setStatus(TRACKING_STATUS.REQUESTING_CAMERA);
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => resolve();
      });
      await this.video.play();

      this._setStatus(TRACKING_STATUS.LOADING_MODEL);
      await this._loadLandmarker();

      document.addEventListener('visibilitychange', this._handleVisibility);

      this._setStatus(TRACKING_STATUS.RUNNING);
      this.running = true;
      this._loop();
    } catch (err) {
      this._fail(err);
      throw err;
    }
  }

  async _loadLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    const baseOptions = { modelAssetPath: MODEL_URL };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: this.numHands,
      });
    } catch (gpuErr) {
      // Not every GPU/browser combination supports the WebGL delegate - CPU
      // is slower but works everywhere WASM does.
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: this.numHands,
      });
    }
  }

  _loop() {
    if (!this.running) return;
    if (this.video.readyState >= 2 && this.video.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = this.video.currentTime;
      const result = this.landmarker.detectForVideo(this.video, performance.now());
      this.onResults(result.landmarks || []);
    }
    this._rafId = requestAnimationFrame(() => this._loop());
  }

  _handleVisibility() {
    if (document.hidden) {
      this.running = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._setStatus(TRACKING_STATUS.PAUSED);
    } else if (this.landmarker && !this.running) {
      this.running = true;
      this._setStatus(TRACKING_STATUS.RUNNING);
      this._loop();
    }
  }

  _setStatus(status) {
    this.onStatusChange(status);
  }

  _fail(err) {
    this._setStatus(TRACKING_STATUS.ERROR);
    this.onError(err);
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    document.removeEventListener('visibilitychange', this._handleVisibility);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }
}
