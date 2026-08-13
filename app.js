import {
  instantiateFaustModuleFromFile,
  LibFaust,
  FaustCompiler,
  FaustMonoDspGenerator,
} from "./faustwasm-bundle.js";

const powerBtn = document.getElementById("powerBtn");
const statusEl = document.getElementById("status");
const xyPad = document.getElementById("xyPad");
const xyDot = document.getElementById("xyDot");

let audioContext = null;
let compiler = null;   // Faust compiler, built once and reused
let dspCode = null;    // .dsp source text, fetched once and reused
let node = null;       // the compiled Faust AudioWorkletNode
let gainNode = null;   // sits between node and destination, sound on/off lives here
let ready = false;     // true once node is compiled and connected (engine built)
let booting = false;

const CARRIER_MIN = 40, CARRIER_MAX = 1500;
const INDEX_MIN = 0, INDEX_MAX = 20;

let carrierPath = null;
let indexPath = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function loadDspSource() {
  if (dspCode) return dspCode;
  const res = await fetch("./fm.dsp");
  dspCode = await res.text();
  return dspCode;
}

function resolveParamPaths(n) {
  const params = n.getParams();
  carrierPath = params.find((p) => p.toLowerCase().includes("carrierfreq"));
  indexPath = params.find((p) => p.toLowerCase().includes("modindex"));
}

// --- Build the engine: called on the power button tap ---
async function buildSynth() {
  if (ready || booting) return;
  booting = true;
  powerBtn.disabled = true;
  setStatus("Starting…");

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();

    if (!compiler) {
      setStatus("Loading Faust compiler…");
      const faustModule = await instantiateFaustModuleFromFile("./libfaust/libfaust-wasm.js");
      const libFaust = new LibFaust(faustModule);
      compiler = new FaustCompiler(libFaust);
    }

    const code = await loadDspSource();

    setStatus("Compiling DSP…");
    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, "fmSynth", code, "");

    node = await generator.createNode(audioContext);
    if (!node) throw new Error("Failed to create audio node");

    resolveParamPaths(node);

    gainNode = audioContext.createGain();
    gainNode.gain.value = 0; // silent until a finger is actually on the pad
    node.connect(gainNode);
    gainNode.connect(audioContext.destination);

    applyPadPosition();

    ready = true;
    powerBtn.textContent = "⏻ Enabled";
    powerBtn.classList.add("on");
    xyPad.classList.add("active");
    setStatus("Touch the pad to play");
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message);
  } finally {
    booting = false;
    powerBtn.disabled = false;
  }
}

powerBtn.addEventListener("click", buildSynth);

// --- XY Pad ---
// The pad is now the sound on/off control:
//   finger down + inside pad  -> sound on, params tracking
//   finger moves outside pad  -> sound off (muted), but drag continues to be tracked
//   finger re-enters pad      -> sound back on
//   finger lifts / cancels    -> sound off
let padX = 0.35;
let padY = 0.2;
let sounding = false;

function setSounding(on) {
  if (!ready || sounding === on) return;
  sounding = on;
  if (audioContext && gainNode) {
    gainNode.gain.setTargetAtTime(on ? 1 : 0, audioContext.currentTime, 0.008);
  }
  xyDot.classList.toggle("live", on);
  if (on) {
    const carrierFreq = CARRIER_MIN + padX * (CARRIER_MAX - CARRIER_MIN);
    const modIndex = INDEX_MIN + padY * (INDEX_MAX - INDEX_MIN);
    setStatus(`carrier ${carrierFreq.toFixed(0)} Hz · index ${modIndex.toFixed(1)}`);
  } else {
    setStatus(ready ? "Touch the pad to play" : "Tap the power button to start");
  }
}

function applyPadPosition() {
  if (!node) return;
  const carrierFreq = CARRIER_MIN + padX * (CARRIER_MAX - CARRIER_MIN);
  const modIndex = INDEX_MIN + padY * (INDEX_MAX - INDEX_MIN);
  if (carrierPath) node.setParamValue(carrierPath, carrierFreq);
  if (indexPath) node.setParamValue(indexPath, modIndex);
  updateDotPosition();
  if (sounding) {
    setStatus(`carrier ${carrierFreq.toFixed(0)} Hz · index ${modIndex.toFixed(1)}`);
  }
}

function updateDotPosition() {
  const rect = xyPad.getBoundingClientRect();
  xyDot.style.left = `${padX * rect.width}px`;
  xyDot.style.top = `${(1 - padY) * rect.height}px`;
}

// Clamp position for the *dot visual* to pad bounds, but track whether the
// raw finger position is actually inside the pad rect (for sound on/off).
function handlePadPointer(clientX, clientY, isInsideCheck) {
  const rect = xyPad.getBoundingClientRect();
  const insideX = clientX >= rect.left && clientX <= rect.right;
  const insideY = clientY >= rect.top && clientY <= rect.bottom;
  const inside = insideX && insideY;

  padX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  padY = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
  applyPadPosition();

  if (isInsideCheck) setSounding(inside);
}

let dragging = false;

xyPad.addEventListener("pointerdown", (e) => {
  if (!ready) return;
  dragging = true;
  // Capture on the pad so we keep receiving move events even once the
  // finger drifts outside the pad's bounds (needed to detect re-entry).
  xyPad.setPointerCapture(e.pointerId);
  handlePadPointer(e.clientX, e.clientY, true);
});
xyPad.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  handlePadPointer(e.clientX, e.clientY, true);
});
xyPad.addEventListener("pointerup", () => {
  dragging = false;
  setSounding(false);
});
xyPad.addEventListener("pointercancel", () => {
  dragging = false;
  setSounding(false);
});

window.addEventListener("resize", updateDotPosition);
window.addEventListener("load", updateDotPosition);

setStatus("Tap the power button to start");
