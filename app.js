import {
  instantiateFaustModuleFromFile,
  LibFaust,
  FaustCompiler,
  FaustMonoDspGenerator,
} from "./faustwasm-bundle.js";

const toggleBtn = document.getElementById("toggleBtn");
const statusEl = document.getElementById("status");
const xyPad = document.getElementById("xyPad");
const xyDot = document.getElementById("xyDot");

let audioContext = null;
let compiler = null;
let dspCode = null;
let node = null;
let playing = false;
let booting = false;

// Param ranges — must match the hslider() bounds in fm.dsp
const CARRIER_MIN = 40, CARRIER_MAX = 1500;
const INDEX_MIN = 0, INDEX_MAX = 20;

// Resolved once the node is created (paths come straight from the compiled DSP)
let carrierPath = null;
let indexPath = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function loadDspSource() {
  const res = await fetch("./fm.dsp");
  return await res.text();
}

async function ensureCompiled() {
  if (compiler) return;
  setStatus("Loading Faust compiler…");
  const faustModule = await instantiateFaustModuleFromFile("./libfaust/libfaust-wasm.js");
  const libFaust = new LibFaust(faustModule);
  compiler = new FaustCompiler(libFaust);
  dspCode = await loadDspSource();
}

function resolveParamPaths(newNode) {
  const params = newNode.getParams(); // e.g. ["/fmSynth/carrierFreq", "/fmSynth/modIndex"]
  carrierPath = params.find((p) => p.toLowerCase().includes("carrierfreq"));
  indexPath = params.find((p) => p.toLowerCase().includes("modindex"));
}

async function startAudio() {
  if (playing || booting) return;
  booting = true;
  toggleBtn.disabled = true;
  setStatus("Starting…");

  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    await audioContext.resume();

    await ensureCompiled();

    setStatus("Compiling DSP…");
    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, "fmSynth", dspCode, "");

    node = await generator.createNode(audioContext);
    if (!node) throw new Error("Failed to create audio node");

    resolveParamPaths(node);
    node.connect(audioContext.destination);

    // Apply current pad position immediately
    applyPadPosition();

    playing = true;
    toggleBtn.textContent = "■ Stop";
    xyPad.classList.add("active");
    setStatus("Playing");
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message);
  } finally {
    booting = false;
    toggleBtn.disabled = false;
  }
}

function stopAudio() {
  if (!playing) return;
  if (node) {
    node.disconnect();
    if (typeof node.destroy === "function") node.destroy();
    node = null;
  }
  playing = false;
  toggleBtn.textContent = "▶ Start";
  xyPad.classList.remove("active");
  setStatus("Stopped");
}

toggleBtn.addEventListener("click", () => {
  if (playing) stopAudio();
  else startAudio();
});

// --- XY Pad ---
// X axis -> carrier frequency (Hz), Y axis -> FM index (0 = bottom, max = top)
let padX = 0.35; // normalized 0..1, initial position
let padY = 0.2;

function applyPadPosition() {
  if (!node) return;
  const carrierFreq = CARRIER_MIN + padX * (CARRIER_MAX - CARRIER_MIN);
  const modIndex = INDEX_MIN + padY * (INDEX_MAX - INDEX_MIN);
  if (carrierPath) node.setParamValue(carrierPath, carrierFreq);
  if (indexPath) node.setParamValue(indexPath, modIndex);
  updateDotPosition();
  setStatus(`carrier ${carrierFreq.toFixed(0)} Hz · index ${modIndex.toFixed(1)}`);
}

function updateDotPosition() {
  const rect = xyPad.getBoundingClientRect();
  xyDot.style.left = `${padX * rect.width}px`;
  xyDot.style.top = `${(1 - padY) * rect.height}px`; // invert Y: up = higher index
}

function handlePadPointer(clientX, clientY) {
  const rect = xyPad.getBoundingClientRect();
  padX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  padY = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
  applyPadPosition();
}

let dragging = false;

xyPad.addEventListener("pointerdown", (e) => {
  dragging = true;
  xyPad.setPointerCapture(e.pointerId);
  handlePadPointer(e.clientX, e.clientY);
});
xyPad.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  handlePadPointer(e.clientX, e.clientY);
});
xyPad.addEventListener("pointerup", () => { dragging = false; });
xyPad.addEventListener("pointercancel", () => { dragging = false; });

// Keep dot positioned correctly on resize
window.addEventListener("resize", updateDotPosition);
window.addEventListener("load", updateDotPosition);
