/**
 * Rasterize the icon tile from assets/icon.svg (viewBox 0 0 680 420).
 * Run from project root: node scripts/svgToIcon.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const svgPath = path.join(root, "assets", "icon.svg");
const outIcon = path.join(root, "assets", "icon.png");
const outAdaptive = path.join(root, "assets", "adaptive-icon.png");

const svg = fs.readFileSync(svgPath);

sharp(svg, { density: 300 })
  .extract({ left: 190, top: 10, width: 300, height: 300 })
  .resize(1024, 1024)
  .png()
  .toFile(outIcon)
  .then(() => console.log("Done icon.png"));

sharp(svg, { density: 300 })
  .extract({ left: 190, top: 10, width: 300, height: 300 })
  .resize(1024, 1024)
  .png()
  .toFile(outAdaptive)
  .then(() => console.log("Done adaptive-icon.png"));
