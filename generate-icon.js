/**
 * Generates a simple microphone SVG icon and converts it to PNG using
 * the canvas API available via the `canvas` npm package.
 * Run once: node generate-icon.js
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// Background: rounded rect gradient
const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
grad.addColorStop(0, '#1a1a2e');
grad.addColorStop(1, '#16213e');

const R = SIZE * 0.18;
ctx.beginPath();
ctx.moveTo(R, 0);
ctx.lineTo(SIZE - R, 0);
ctx.quadraticCurveTo(SIZE, 0, SIZE, R);
ctx.lineTo(SIZE, SIZE - R);
ctx.quadraticCurveTo(SIZE, SIZE, SIZE - R, SIZE);
ctx.lineTo(R, SIZE);
ctx.quadraticCurveTo(0, SIZE, 0, SIZE - R);
ctx.lineTo(0, R);
ctx.quadraticCurveTo(0, 0, R, 0);
ctx.closePath();
ctx.fillStyle = grad;
ctx.fill();

// Microphone body
ctx.strokeStyle = '#007aff';
ctx.lineWidth = SIZE * 0.055;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

const cx = SIZE / 2;
const micTop = SIZE * 0.2;
const micBottom = SIZE * 0.58;
const micW = SIZE * 0.18;
const micR = micW;

// Mic capsule
ctx.beginPath();
ctx.moveTo(cx - micW, micTop + micR);
ctx.arc(cx - micW, micTop + micR, micR, Math.PI, 0, false);  // top arc left
ctx.lineTo(cx + micW, micTop + micR);
// right side down
ctx.lineTo(cx + micW, micBottom - micR);
// bottom arc
ctx.arc(cx, micBottom, micW, 0, Math.PI, false);
// left side up
ctx.lineTo(cx - micW, micTop + micR);
ctx.strokeStyle = '#007aff';
ctx.stroke();

// Stand arc
const standY = micBottom + SIZE * 0.01;
const standR = SIZE * 0.22;
ctx.beginPath();
ctx.arc(cx, standY, standR, Math.PI, 0, true);
ctx.strokeStyle = '#007aff';
ctx.stroke();

// Vertical line
ctx.beginPath();
ctx.moveTo(cx, standY);
ctx.lineTo(cx, standY + SIZE * 0.1);
ctx.stroke();

// Base
ctx.beginPath();
ctx.moveTo(cx - SIZE * 0.14, standY + SIZE * 0.1);
ctx.lineTo(cx + SIZE * 0.14, standY + SIZE * 0.1);
ctx.stroke();

const buffer = canvas.toBuffer('image/png');
const outPath = path.join(__dirname, 'assets', 'icon.png');
fs.writeFileSync(outPath, buffer);
console.log(`Icon written to ${outPath}`);
