import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTargetDimensions,
  validateShelfCapacity,
  formatPhotoCountLabel,
  generateSessionName,
} from './imageUtils';

test('calculateTargetDimensions scales landscape photos to maxWidth', () => {
  const result = calculateTargetDimensions(4000, 3000, 1280);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 960);
});

test('calculateTargetDimensions scales portrait photos to maxHeight', () => {
  const result = calculateTargetDimensions(1080, 1920, 1280);
  assert.equal(result.height, 1280);
  assert.equal(result.width, 720);
});

test('calculateTargetDimensions does not upscale images already smaller than maxDim', () => {
  const result = calculateTargetDimensions(800, 600, 1280);
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
});

test('validateShelfCapacity parses valid integers and rejects invalid inputs', () => {
  assert.equal(validateShelfCapacity(24), 24);
  assert.equal(validateShelfCapacity('48'), 48);
  assert.equal(validateShelfCapacity('  12  '), 12);
  assert.equal(validateShelfCapacity(0), null);
  assert.equal(validateShelfCapacity(-5), null);
  assert.equal(validateShelfCapacity('abc'), null);
  assert.equal(validateShelfCapacity(null), null);
  assert.equal(validateShelfCapacity(undefined), null);
  assert.equal(validateShelfCapacity(10000), null); // Over realistic shelf capacity limit
});

test('formatPhotoCountLabel applies correct Arabic pluralization', () => {
  assert.equal(formatPhotoCountLabel(0), 'لم يتم التقاط صور بعد');
  assert.equal(formatPhotoCountLabel(1), 'تم التقاط: صورة واحدة');
  assert.equal(formatPhotoCountLabel(2), 'تم التقاط: صورتان');
  assert.equal(formatPhotoCountLabel(4), 'تم التقاط: 4 صور');
  assert.equal(formatPhotoCountLabel(10), 'تم التقاط: 10 صور');
  assert.equal(formatPhotoCountLabel(11), 'تم التقاط: 11 صورة');
  assert.equal(formatPhotoCountLabel(25), 'تم التقاط: 25 صورة');
});

test('generateSessionName includes date and time elements', () => {
  const fixedDate = new Date(2026, 10, 12, 14, 30);
  const name = generateSessionName(fixedDate);
  assert.match(name, /جولة تفقد الأرفف/);
  assert.match(name, /14:30/);
});
