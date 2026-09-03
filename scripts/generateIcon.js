const { createCanvas } = require("canvas");
const fs = require("fs");
const size = 1024;
const s = size / 680;

const canvas = createCanvas(size, size);
const ctx = canvas.getContext("2d");

// Background rounded rect
ctx.fillStyle = "#060d08";
ctx.beginPath();
ctx.roundRect(0, 0, size, size, 90 * s);
ctx.fill();

// P vertical stem fill (bigger, higher)
ctx.globalAlpha = 0.12;
ctx.fillStyle = "#00ff88";
ctx.beginPath();
ctx.roundRect(170 * s, 80 * s, 90 * s, 360 * s, 12 * s);
ctx.fill();

// P vertical stem stroke
ctx.globalAlpha = 0.5;
ctx.strokeStyle = "#00ff88";
ctx.lineWidth = 4 * s;
ctx.beginPath();
ctx.roundRect(170 * s, 80 * s, 90 * s, 360 * s, 12 * s);
ctx.stroke();

// P bump outer
ctx.beginPath();
ctx.moveTo(215 * s, 80 * s);
ctx.quadraticCurveTo(410 * s, 80 * s, 410 * s, 200 * s);
ctx.quadraticCurveTo(410 * s, 320 * s, 215 * s, 320 * s);
ctx.stroke();

// P bump inner fill
ctx.globalAlpha = 0.06;
ctx.fillStyle = "#00ff88";
ctx.beginPath();
ctx.moveTo(220 * s, 95 * s);
ctx.quadraticCurveTo(385 * s, 95 * s, 385 * s, 200 * s);
ctx.quadraticCurveTo(385 * s, 305 * s, 220 * s, 305 * s);
ctx.fill();

// Graph line
ctx.globalAlpha = 1;
ctx.strokeStyle = "#00ff88";
ctx.lineWidth = 9 * s;
ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.beginPath();
ctx.moveTo(110 * s, 360 * s);
ctx.lineTo(170 * s, 280 * s);
ctx.lineTo(250 * s, 305 * s);
ctx.lineTo(340 * s, 190 * s);
ctx.lineTo(430 * s, 225 * s);
ctx.lineTo(520 * s, 145 * s);
ctx.lineTo(590 * s, 165 * s);
ctx.stroke();

// Graph dots
ctx.fillStyle = "#00ff88";
[
  [110, 360, 10],
  [340, 190, 10],
  [590, 165, 13],
].forEach(([x, y, r]) => {
  ctx.beginPath();
  ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2);
  ctx.fill();
});

// Glow dot
ctx.globalAlpha = 0.15;
ctx.beginPath();
ctx.arc(590 * s, 165 * s, 28 * s, 0, Math.PI * 2);
ctx.fill();
ctx.globalAlpha = 1;

// PAISAWISE text
ctx.fillStyle = "#00ff88";
ctx.font = `bold ${44 * s}px sans-serif`;
ctx.textAlign = "center";
ctx.fillText("PAISAWISE", 340 * s, 555 * s);

// AI BUDGET PLANNER text
ctx.globalAlpha = 0.7;
ctx.fillStyle = "#00cc66";
ctx.font = `${24 * s}px sans-serif`;
ctx.fillText("AI BUDGET PLANNER", 340 * s, 605 * s);
ctx.globalAlpha = 1;

// Rupee badge circle
ctx.fillStyle = "#00ff88";
ctx.beginPath();
ctx.arc(545 * s, 440 * s, 55 * s, 0, Math.PI * 2);
ctx.fill();

// Rupee symbol
ctx.fillStyle = "#060d08";
ctx.font = `bold ${52 * s}px serif`;
ctx.textAlign = "center";
ctx.fillText("₨", 545 * s, 458 * s);

// Save
const buf = canvas.toBuffer("image/png");
fs.writeFileSync("assets/icon.png", buf);
fs.writeFileSync("assets/adaptive-icon.png", buf);
console.log("✅ Icons generated at 1024x1024!");
