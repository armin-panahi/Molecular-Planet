/**
 * gestureRecognizer.js
 * -----------------------------------------------------------------------
 * Pure geometry over MediaPipe HandLandmarker output (21 landmarks/hand,
 * each {x, y, z} normalized to the video frame). No DOM, no Three.js, no
 * MediaPipe imports here on purpose — every function is a plain function
 * of numbers so it can be unit tested with synthetic landmark arrays
 * (see /test/gestureRecognizer.test.mjs).
 *
 * Landmark index reference:
 *   0 WRIST
 *   1-4   THUMB   (CMC, MCP, IP, TIP)
 *   5-8   INDEX   (MCP, PIP, DIP, TIP)
 *   9-12  MIDDLE  (MCP, PIP, DIP, TIP)
 *   13-16 RING    (MCP, PIP, DIP, TIP)
 *   17-20 PINKY   (MCP, PIP, DIP, TIP)
 */

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

export const POSE = {
  FIST: 'fist',
  OPEN_PALM: 'open_palm',
  POINT: 'point',
  TRANSITION: 'transition',
};

// ---- vector helpers --------------------------------------------------

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function distance(a, b) {
  return length(sub(a, b));
}

export function normalize(a) {
  const len = length(a) || 1e-6;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Midpoint of an arbitrary list of landmarks. */
export function centroid(points) {
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 }
  );
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

// ---- finger curl -------------------------------------------------------

/**
 * Angle (degrees) at the PIP joint between the MCP->PIP and PIP->TIP
 * segments. ~180deg = finger fully straight/extended, small angle =
 * finger folded back onto the palm. Orientation-invariant (works at any
 * hand rotation) since it only compares joint-relative vectors.
 */
export function fingerCurlAngle(mcp, pip, tip) {
  const v1 = normalize(sub(mcp, pip));
  const v2 = normalize(sub(tip, pip));
  const d = clamp(dot(v1, v2), -1, 1);
  return (Math.acos(d) * 180) / Math.PI;
}

export function curlAngles(landmarks) {
  return {
    index: fingerCurlAngle(landmarks[LM.INDEX_MCP], landmarks[LM.INDEX_PIP], landmarks[LM.INDEX_TIP]),
    middle: fingerCurlAngle(landmarks[LM.MIDDLE_MCP], landmarks[LM.MIDDLE_PIP], landmarks[LM.MIDDLE_TIP]),
    ring: fingerCurlAngle(landmarks[LM.RING_MCP], landmarks[LM.RING_PIP], landmarks[LM.RING_TIP]),
    pinky: fingerCurlAngle(landmarks[LM.PINKY_MCP], landmarks[LM.PINKY_PIP], landmarks[LM.PINKY_TIP]),
  };
}

/** Palm scale reference used to normalize distances across hand sizes / camera distance. */
export function palmSize(landmarks) {
  return distance(landmarks[LM.WRIST], landmarks[LM.MIDDLE_MCP]) || 1e-6;
}

/** Thumb-tip to index-tip distance, normalized by palm size (~0 touching .. ~2+ wide open). */
export function normalizedPinchDistance(landmarks) {
  return distance(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) / palmSize(landmarks);
}

const EXTEND_ON = 140; // deg: must exceed this to register as "extended"
const EXTEND_OFF = 115; // deg: must drop below this to register as "curled" (hysteresis gap avoids flicker)

/**
 * Classifies a single frame's 4-finger extension state with hysteresis
 * against the *previous* extension booleans, so a finger sitting right at
 * the boundary doesn't flicker every frame.
 */
export function extensionState(landmarks, previous = {}) {
  const angles = curlAngles(landmarks);
  const next = {};
  for (const finger of ['index', 'middle', 'ring', 'pinky']) {
    const wasExtended = !!previous[finger];
    const onThresh = wasExtended ? EXTEND_OFF : EXTEND_ON;
    next[finger] = wasExtended ? angles[finger] > EXTEND_OFF : angles[finger] > onThresh;
  }
  return next;
}

const PINCH_ON = 0.35; // normalized distance below which a pinch is considered active
const PINCH_OFF = 0.5; // must widen past this to release the pinch (hysteresis)

export function isPinching(landmarks, wasPinching = false) {
  const d = normalizedPinchDistance(landmarks);
  return wasPinching ? d < PINCH_OFF : d < PINCH_ON;
}

/**
 * Classifies overall hand pose from finger extension booleans.
 * Pinch is intentionally NOT a pose here — it is measured continuously
 * and takes priority upstream in the interaction controller regardless
 * of what the other fingers are doing.
 */
export function classifyPose(extended) {
  const count = ['index', 'middle', 'ring', 'pinky'].filter((f) => extended[f]).length;
  if (extended.index && !extended.middle && !extended.ring && !extended.pinky) {
    return POSE.POINT;
  }
  if (count === 0) return POSE.FIST;
  if (count >= 3) return POSE.OPEN_PALM;
  return POSE.TRANSITION;
}

/**
 * Stateful per-hand tracker: wraps the pure functions above with
 * hysteresis + exponential smoothing so continuous gestures (rotate/pan/
 * zoom/explode) feel stable frame to frame instead of jittering with raw
 * landmark noise.
 */
export class HandGestureTracker {
  constructor({ smoothing = 0.35 } = {}) {
    this.smoothing = smoothing;
    this.extended = { index: false, middle: false, ring: false, pinky: false };
    this.pinching = false;
    this.smoothedPalm = null;
    this.smoothedPinch = null;
    this.smoothedIndexTip = null;
  }

  /** Feed one frame of 21 landmarks, get back a stable gesture reading. */
  update(landmarks) {
    this.extended = extensionState(landmarks, this.extended);
    this.pinching = isPinching(landmarks, this.pinching);
    const pose = classifyPose(this.extended);

    const rawPalm = centroid([
      landmarks[LM.WRIST],
      landmarks[LM.INDEX_MCP],
      landmarks[LM.MIDDLE_MCP],
      landmarks[LM.RING_MCP],
      landmarks[LM.PINKY_MCP],
    ]);
    this.smoothedPalm = this.smoothedPalm
      ? {
          x: lerp(this.smoothedPalm.x, rawPalm.x, this.smoothing),
          y: lerp(this.smoothedPalm.y, rawPalm.y, this.smoothing),
          z: lerp(this.smoothedPalm.z, rawPalm.z, this.smoothing),
        }
      : rawPalm;

    const rawPinch = normalizedPinchDistance(landmarks);
    this.smoothedPinch =
      this.smoothedPinch == null ? rawPinch : lerp(this.smoothedPinch, rawPinch, this.smoothing);

    const rawIndexTip = landmarks[LM.INDEX_TIP];
    // Index tip gets lighter smoothing than the palm - it drives pointing/
    // selection, so it should stay responsive while still shedding jitter.
    const tipSmoothing = Math.min(1, this.smoothing + 0.25);
    this.smoothedIndexTip = this.smoothedIndexTip
      ? {
          x: lerp(this.smoothedIndexTip.x, rawIndexTip.x, tipSmoothing),
          y: lerp(this.smoothedIndexTip.y, rawIndexTip.y, tipSmoothing),
          z: lerp(this.smoothedIndexTip.z, rawIndexTip.z, tipSmoothing),
        }
      : rawIndexTip;

    return {
      pose,
      isPinching: this.pinching,
      pinchDistance: this.smoothedPinch,
      palmCenter: this.smoothedPalm,
      indexTip: this.smoothedIndexTip,
      wrist: landmarks[LM.WRIST],
    };
  }
}
