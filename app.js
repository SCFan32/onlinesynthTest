import {
  instantiateFaustModuleFromFile,
  LibFaust,
  FaustCompiler,
  FaustMonoDspGenerator,
} from "./faustwasm-bundle.js";

const powerBtn = document.getElementById("powerBtn");
const muteBtn = document.getElementById("muteBtn");
const statusEl = document.getElementById("status");
const xyPad = document.getElementById("xyPad");
const xyDot = document.getElementById("xyDot");

let audioContext = null;
let compiler = null;   // Faust compiler, built once and reused
let dspCode = null;    // .dsp source text, fetched once and reused
let node = null;       // the compiled Faust AudioWorkletNode
let gainNode = null;   // sits between node and destination, used for mute
let ready = false;     // true once node is compiled and connected
let booting = false;
let powerOn = false;
let muted = false;

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

// --- Build everything: called on first "On" tap, inside the user gesture ---
async function buildSynth() {
  if (ready || booting) return;
  booting = true;
  powerBtn.disabled = true;
  setStatus("Starting…");

  try {
    // AudioContext must be created (or resumed) inside the gesture on iOS
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
    gainNode.gain.value = muted ? 0 : 1;
    node.connect(gainNode);
    gainNode.connect(audioContext.destination);

    applyPadPosition();

    ready = true;
    powerOn = true;
    powerBtn.textContent = "⏻ On";
    powerBtn.classList.add("on");
    xyPad.classList.add("active");
    setStatus(muted ? "On (muted)" : "Playing");
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message);
  } finally {
    booting = false;
    powerBtn.disabled = false;
  }
}

// --- Power switch ---
// First press: builds everything (compile + node creation), then turns on.
// Later presses: cheap connect/disconnect + gain ramp, no recompiling.
async function setPower(on) {
  if (!ready) {
    if (on) await buildSynth();
    return;
  }
  powerOn = on;
  if (on) {
    await audioContext.resume();
    gainNode.gain.setTargetAtTime(muted ? 0 : 1, audioContext.currentTime, 0.01);
    powerBtn.textContent = "⏻ On";
    powerBtn.classList.add("on");
    xyPad.classList.add("active");
    setStatus(muted ? "On (muted)" : "Playing");
  } else {
    gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
    powerBtn.textContent = "⏻ Off";
    powerBtn.classList.remove("on");
    xyPad.classList.remove("active");
    setStatus("Off");
  }
}

function setMute(on) {
  muted = on;
  muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound";
  muteBtn.classList.toggle("muted", muted);
  if (powerOn && ready) {
    gainNode.gain.setTargetAtTime(muted ? 0 : 1, audioContext.currentTime, 0.01);
    setStatus(muted ? "On (muted)" : "Playing");
  }
}

powerBtn.addEventListener("click", () => setPower(!powerOn));
muteBtn.addEventListener("click", () => setMute(!muted));

// --- XY Pad ---
let padX = 0.35;
let padY = 0.2;

function applyPadPosition() {
  if (!node) return;
  const carrierFreq = CARRIER_MIN + padX * (CARRIER_MAX - CARRIER_MIN);
  const modIndex = INDEX_MIN + padY * (INDEX_MAX - INDEX_MIN);
  if (carrierPath) node.setParamValue(carrierPath, carrierFreq);
  if (indexPath) node.setParamValue(indexPath, modIndex);
  updateDotPosition();
  if (powerOn && !muted) {
    setStatus(`carrier ${carrierFreq.toFixed(0)} Hz · index ${modIndex.toFixed(1)}`);
  }
}

function updateDotPosition() {
  const rect = xyPad.getBoundingClientRect();
  xyDot.style.left = `${padX * rect.width}px`;
  xyDot.style.top = `${(1 - padY) * rect.height}px`;
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

window.addEventListener("resize", updateDotPosition);
window.addEventListener("load", updateDotPosition);

setStatus("Tap the power button to start");
