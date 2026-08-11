import * as THREE from 'three';
import { HandGestureTracker, POSE } from './gestureRecognizer.js';

export const MODE = {
  IDLE: 'idle',
  ZOOM: 'zoom',
  ROTATE: 'rotate',
  PAN: 'pan',
  SELECT: 'select',
  EXPLODE: 'explode',
};

// Tunable feel constants - adjust these first if a gesture feels too
// twitchy or too sluggish for your camera/lighting setup.
const ZOOM_MIN = 2.2;
const ZOOM_MAX = 22;
const ZOOM_SENSITIVITY = 14;
const ROTATE_SENSITIVITY = 3.4;
const PAN_SENSITIVITY = 9;
const PAN_LIMIT_X = 6;
const PAN_LIMIT_Y = 4;
const EXPLODE_SENSITIVITY = 3.2;
const DWELL_SELECT_MS = 650;
const HAND_DROP_GRACE_FRAMES = 6;

/**
 * InteractionController
 * -----------------------------------------------------------------------
 * Owns the gesture -> action state machine. Single source of truth for
 * "what does the current hand pose let the user do right now".
 *
 * Mode priority when exactly one hand is visible:
 *   pinch (thumb+index close)  -> ZOOM    (highest priority: deliberate, rare by accident)
 *   point (only index out)     -> SELECT
 *   fist  (all fingers curled) -> PAN
 *   open palm (fingers out)    -> ROTATE
 * Two hands visible at once always means EXPLODE, regardless of finger pose.
 *
 * IMPORTANT coordinate note: MediaPipe landmarks are in *raw, unmirrored*
 * camera space, but the webcam preview is displayed mirrored (CSS
 * scaleX(-1)) so it behaves like a normal mirror. Every place below that
 * turns a horizontal delta or x-coordinate into an on-screen effect flips
 * its sign (or does `1 - x`) to stay consistent with what the user
 * actually sees, so "drag right on the mirror" always means "right" here.
 */
export class InteractionController {
  constructor({ camera, planet, onModeChange, onMoleculeSelected, onMoleculeHover }) {
    this.camera = camera;
    this.planet = planet;
    this.onModeChange = onModeChange || (() => {});
    this.onMoleculeSelected = onMoleculeSelected || (() => {});
    this.onMoleculeHover = onMoleculeHover || (() => {});

    this.trackers = [new HandGestureTracker(), new HandGestureTracker()];
    this.raycaster = new THREE.Raycaster();

    this.mode = MODE.IDLE;
    this._prevPalm = null;
    this._prevPinch = null;
    this._prevHandsDist = null;
    this._dwellTarget = null;
    this._dwellStart = 0;
    this._missingSecondHandFrames = 0;
    this._lastEffectiveHandCount = 0;
  }

  /**
   * @param {Array<Array<{x:number,y:number,z:number}>>} handsLandmarks 0-2 hands, 21 points each, raw MediaPipe space.
   */
  update(handsLandmarks) {
    const rawCount = handsLandmarks.length;
    let effectiveCount = rawCount;

    // Briefly hold a 2-hand gesture steady if the second hand drops out for
    // a few frames (common with fast motion / partial occlusion), so the
    // explosion factor doesn't jump back to 1-hand mode on a flicker.
    if (rawCount === 1 && this._lastRawHandCount === 2 && this._missingSecondHandFrames < HAND_DROP_GRACE_FRAMES) {
      this._missingSecondHandFrames++;
      effectiveCount = 2;
    } else if (rawCount === 2) {
      this._missingSecondHandFrames = 0;
    }
    this._lastRawHandCount = rawCount;

    if (rawCount === 0) {
      this._setMode(MODE.IDLE);
      this._resetContinuousState();
      this._clearDwell();
      this.planet.setHighlighted(null);
      this.onMoleculeHover(null);
      return;
    }

    if (effectiveCount >= 2) {
      this._handleExplode(handsLandmarks);
      return;
    }

    // Not in a genuine 2-hand frame right now - clear the two-hand distance
    // baseline so the *next* explode session starts clean instead of diffing
    // against a stale distance from a previous one (see _handleExplode).
    this._prevHandsDist = null;

    const reading = this.trackers[0].update(handsLandmarks[0]);

    if (reading.isPinching) {
      this._handleZoom(reading);
    } else if (reading.pose === POSE.POINT) {
      this._handleSelect(reading);
    } else if (reading.pose === POSE.FIST) {
      this._handlePan(reading);
    } else if (reading.pose === POSE.OPEN_PALM) {
      this._handleRotate(reading);
    } else {
      this._setMode(MODE.IDLE);
      this._resetContinuousState();
    }

    if (reading.pose !== POSE.POINT) {
      this._clearDwell();
      this.planet.setHighlighted(null);
      this.onMoleculeHover(null);
    }
  }

  _setMode(mode) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.onModeChange(mode);
    }
  }

  _resetContinuousState() {
    this._prevPalm = null;
    this._prevPinch = null;
    this._prevHandsDist = null;
  }

  _handleZoom(reading) {
    this._setMode(MODE.ZOOM);
    if (this._prevPinch != null) {
      // Spreading fingers apart (distance increasing) zooms IN, matching
      // the familiar touchscreen pinch-to-zoom convention.
      const delta = reading.pinchDistance - this._prevPinch;
      const nextZ = THREE.MathUtils.clamp(this.camera.position.z - delta * ZOOM_SENSITIVITY, ZOOM_MIN, ZOOM_MAX);
      this.camera.position.z = nextZ;
    }
    this._prevPinch = reading.pinchDistance;
    this._prevPalm = null;
  }

  _handleRotate(reading) {
    this._setMode(MODE.ROTATE);
    if (this._prevPalm) {
      const dx = reading.palmCenter.x - this._prevPalm.x; // raw space
      const dy = reading.palmCenter.y - this._prevPalm.y;
      // x is mirrored (see class docstring) -> subtract raw dx.
      this.planet.group.rotation.y -= dx * ROTATE_SENSITIVITY;
      // y is not mirrored -> add raw dy directly (hand down = near surface dips down).
      this.planet.group.rotation.x += dy * ROTATE_SENSITIVITY;
      this.planet.group.rotation.x = THREE.MathUtils.clamp(this.planet.group.rotation.x, -1.3, 1.3);
    }
    this._prevPalm = { x: reading.palmCenter.x, y: reading.palmCenter.y, z: reading.palmCenter.z };
    this._prevPinch = null;
  }

  _handlePan(reading) {
    this._setMode(MODE.PAN);
    if (this._prevPalm) {
      const dx = reading.palmCenter.x - this._prevPalm.x;
      const dy = reading.palmCenter.y - this._prevPalm.y;
      this.planet.group.position.x -= dx * PAN_SENSITIVITY; // mirrored x
      this.planet.group.position.y -= dy * PAN_SENSITIVITY; // hand down -> planet down
      this.planet.group.position.x = THREE.MathUtils.clamp(this.planet.group.position.x, -PAN_LIMIT_X, PAN_LIMIT_X);
      this.planet.group.position.y = THREE.MathUtils.clamp(this.planet.group.position.y, -PAN_LIMIT_Y, PAN_LIMIT_Y);
    }
    this._prevPalm = { x: reading.palmCenter.x, y: reading.palmCenter.y, z: reading.palmCenter.z };
    this._prevPinch = null;
  }

  _handleSelect(reading) {
    this._setMode(MODE.SELECT);
    this._prevPalm = null;
    this._prevPinch = null;

    const ndcX = (1 - reading.indexTip.x) * 2 - 1; // mirrored
    const ndcY = -(reading.indexTip.y * 2 - 1);
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hit = this.planet.pick(this.raycaster);

    if (!hit) {
      this._clearDwell();
      this.onMoleculeHover(null);
      return;
    }

    const now = performance.now();
    if (this._dwellTarget !== hit.instanceId) {
      this._dwellTarget = hit.instanceId;
      this._dwellStart = now;
    }
    const progress = THREE.MathUtils.clamp((now - this._dwellStart) / DWELL_SELECT_MS, 0, 1);
    this.onMoleculeHover({ ...hit, dwellProgress: progress });

    if (progress >= 1) {
      this.onMoleculeSelected(hit);
      this._clearDwell(); // require leaving + re-dwelling to select again
    }
  }

  _clearDwell() {
    this._dwellTarget = null;
    this._dwellStart = 0;
  }

  _handleExplode(handsLandmarks) {
    this._setMode(MODE.EXPLODE);
    this._prevPalm = null;
    this._prevPinch = null;
    this._clearDwell();
    this.planet.setHighlighted(null);
    this.onMoleculeHover(null);

    const a = this.trackers[0].update(handsLandmarks[0]);
    if (!handsLandmarks[1]) {
      // Second hand is in its grace period (see update()) - hold steady.
      return;
    }
    const b = this.trackers[1].update(handsLandmarks[1]);
    const dist = Math.hypot(a.palmCenter.x - b.palmCenter.x, a.palmCenter.y - b.palmCenter.y);

    if (this._prevHandsDist != null) {
      const delta = dist - this._prevHandsDist;
      this.planet.setExplosionFactor(this.planet.explosionFactor + delta * EXPLODE_SENSITIVITY);
    }
    this._prevHandsDist = dist;
  }
}
