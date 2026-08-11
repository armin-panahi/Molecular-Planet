import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerCurlAngle,
  normalizedPinchDistance,
  isPinching,
  extensionState,
  classifyPose,
  HandGestureTracker,
  POSE,
} from '../js/gestureRecognizer.js';

// ---- synthetic hand builder ---------------------------------------------

function finger(baseX, mcpY, state) {
  const mcp = { x: baseX, y: mcpY, z: 0 };
  const pip = { x: baseX, y: mcpY + 0.12, z: 0 };
  if (state === 'extended') {
    return [mcp, pip, { x: baseX, y: mcpY + 0.22, z: 0 }, { x: baseX, y: mcpY + 0.32, z: 0 }];
  }
  // curled: tip folds back past the pip toward the palm
  return [mcp, pip, { x: baseX, y: mcpY + 0.05, z: 0.05 }, { x: baseX, y: mcpY - 0.02, z: 0.08 }];
}

function buildHand({ index = 'extended', middle = 'extended', ring = 'extended', pinky = 'extended', pinch = 'open' } = {}) {
  const wrist = { x: 0, y: 0, z: 0 };
  const [indexMcp, indexPip, indexDip, indexTip] = finger(0.08, 0.15, index);
  const [middleMcp, middlePip, middleDip, middleTip] = finger(0.02, 0.16, middle);
  const [ringMcp, ringPip, ringDip, ringTip] = finger(-0.04, 0.15, ring);
  const [pinkyMcp, pinkyPip, pinkyDip, pinkyTip] = finger(-0.1, 0.12, pinky);

  const thumbTip = pinch === 'closed' ? { x: indexTip.x + 0.01, y: indexTip.y + 0.01, z: indexTip.z } : { x: -0.15, y: 0.2, z: 0 };

  const lm = new Array(21);
  lm[0] = wrist;
  lm[1] = { x: -0.05, y: 0.05, z: 0 };
  lm[2] = { x: -0.08, y: 0.1, z: 0 };
  lm[3] = { x: -0.11, y: 0.15, z: 0 };
  lm[4] = thumbTip;
  lm[5] = indexMcp; lm[6] = indexPip; lm[7] = indexDip; lm[8] = indexTip;
  lm[9] = middleMcp; lm[10] = middlePip; lm[11] = middleDip; lm[12] = middleTip;
  lm[13] = ringMcp; lm[14] = ringPip; lm[15] = ringDip; lm[16] = ringTip;
  lm[17] = pinkyMcp; lm[18] = pinkyPip; lm[19] = pinkyDip; lm[20] = pinkyTip;
  return lm;
}

// ---- fingerCurlAngle ------------------------------------------------------

test('fingerCurlAngle: straight finger reads ~180deg', () => {
  const angle = fingerCurlAngle({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 });
  assert.ok(Math.abs(angle - 180) < 0.01, `expected ~180, got ${angle}`);
});

test('fingerCurlAngle: fully folded finger reads ~0deg', () => {
  const angle = fingerCurlAngle({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0.2, z: 0 });
  assert.ok(angle < 5, `expected ~0, got ${angle}`);
});

// ---- pinch -----------------------------------------------------------

test('normalizedPinchDistance: open hand is well above the pinch threshold', () => {
  const hand = buildHand({ pinch: 'open' });
  assert.ok(normalizedPinchDistance(hand) > 1, 'expected open pinch distance > 1x palm size');
});

test('isPinching: true when thumb and index tips are brought together', () => {
  const hand = buildHand({ pinch: 'closed' });
  assert.equal(isPinching(hand, false), true);
});

test('isPinching: false when thumb and index are apart', () => {
  const hand = buildHand({ pinch: 'open' });
  assert.equal(isPinching(hand, false), false);
});

test('isPinching: hysteresis keeps a pinch active through a wider gap once started', () => {
  // A distance that is *above* PINCH_ON but still *below* PINCH_OFF should
  // stay "pinching" if it was already pinching, to avoid flicker.
  const hand = buildHand({ pinch: 'open' });
  hand[4] = { x: hand[8].x + 0.06, y: hand[8].y + 0.02, z: 0 }; // mid-range gap
  const d = normalizedPinchDistance(hand);
  assert.ok(d > 0.35 && d < 0.5, `test setup expects a mid-range distance, got ${d}`);
  assert.equal(isPinching(hand, true), true, 'should remain pinching (hysteresis)');
  assert.equal(isPinching(hand, false), false, 'should not newly register as pinching');
});

// ---- pose classification ------------------------------------------------

test('classifyPose: all fingers extended -> OPEN_PALM', () => {
  const hand = buildHand({ index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended' });
  const extended = extensionState(hand, {});
  assert.equal(classifyPose(extended), POSE.OPEN_PALM);
});

test('classifyPose: all fingers curled -> FIST', () => {
  const hand = buildHand({ index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' });
  const extended = extensionState(hand, {});
  assert.equal(classifyPose(extended), POSE.FIST);
});

test('classifyPose: only index extended -> POINT', () => {
  const hand = buildHand({ index: 'extended', middle: 'curled', ring: 'curled', pinky: 'curled' });
  const extended = extensionState(hand, {});
  assert.equal(classifyPose(extended), POSE.POINT);
});

test('classifyPose: exactly two fingers extended -> TRANSITION (ambiguous)', () => {
  const hand = buildHand({ index: 'extended', middle: 'extended', ring: 'curled', pinky: 'curled' });
  const extended = extensionState(hand, {});
  assert.equal(classifyPose(extended), POSE.TRANSITION);
});

// ---- HandGestureTracker (stateful smoothing) -----------------------------

test('HandGestureTracker: classifies open palm end-to-end from raw landmarks', () => {
  const tracker = new HandGestureTracker();
  const reading = tracker.update(buildHand({ index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended' }));
  assert.equal(reading.pose, POSE.OPEN_PALM);
  assert.equal(reading.isPinching, false);
});

test('HandGestureTracker: palm center smooths toward new readings rather than snapping', () => {
  const tracker = new HandGestureTracker({ smoothing: 0.5 });
  const handA = buildHand();
  const handB = buildHand();
  handB[9] = { x: 1, y: 1, z: 0 }; // move middle_mcp (part of palm centroid) far away

  const first = tracker.update(handA);
  const second = tracker.update(handB);

  assert.notEqual(second.palmCenter.x, first.palmCenter.x, 'palm center should move');
  assert.ok(
    second.palmCenter.x < 1 && second.palmCenter.x > first.palmCenter.x,
    'with 0.5 smoothing the center should move partway, not snap all the way to the new raw value'
  );
});

test('HandGestureTracker: pinch distance is smoothed, not instantaneous', () => {
  const tracker = new HandGestureTracker({ smoothing: 0.5 });
  tracker.update(buildHand({ pinch: 'open' }));
  const second = tracker.update(buildHand({ pinch: 'closed' }));
  assert.ok(second.pinchDistance > 0.05, 'should not have fully snapped to the closed-pinch value in one frame');
});
