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
let node = null;       // the compiled Faust AudioWorkletNode (created once, kept alive)
let gainNode = null;   // sits between node and destination, used for mute
let ready = false;     // true once node is compiled and instantiated
let powerOn = false;   // power switch state (connects/disconnects node -> gain)
let muted = false;     // mute switch state (gain 0 vs 1)

const CARRIER_MIN = 40, CARRIER_MAX = 1500;
const INDEX_MIN = 0, INDEX_MAX = 20;

let carrierPath = null;
let indexPath = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function loadDspSource() {
  const res = await fetch("./fm.dsp");
  return await res.text();
}

function resolveParamPaths(n) {
  const params = n.getParams();
  carrierPath = params.find((p) => p.toLowerCase().includes("carrierfreq"));
  indexPath = params.find((p) => p.toLowerCase().includes("modindex"));
}

// --- Precompile as soon as the page loads, so Start is instant later ---
async function precompile() {
  setStatus("Preparing synth…");
  try {
    // AudioContext can be created without a gesture; it just starts "suspended"
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const faustModule = await instantiateFaustModuleFromFile("./libfaust/libfaust-wasm.js");
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);
    const dspCode = await loadDspSource();

    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, "fmSynth", dspCode, "");

    node = await generator.createNode(audioContext);
    if (!node) throw new Error("Failed to create audio node");

    resolveParamPaths(node);

    gainNode = audioContext.createGain();
    gainNode.gain.value = 0; // start muted, connect graph happens on power-on
    node.connect(gainNode);
    gainNode.connect(audioContext.destination);

    applyPadPosition(); // push current pad position into the synth right away

    ready = true;
    powerBtn.disabled = false;
    setStatus("Ready — tap the power button");
  } catch (err) {
    console.error(err);
    setStatus("Error preparing synth: " + err.message);
  }
}

// --- Power switch: resumes context and unmutes according to current mute state ---
async function setPower(on) {
  if (!ready) return;
  powerOn = on;
  if (on) {
    await audioContext.resume(); // needs to happen inside/after a user gesture on iOS
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

// --- Mute switch: independent of power, just a gain flip ---
function setMute(on) {
  muted = on;
  muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound";
  muteBtn.classList.toggle("muted", muted);
  if (powerOn && audioContext) {
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

// Dragging the dot never touches power/mute state — so power/mute buttons
// remain fully tappable mid-drag (important for iOS multi-touch: dragging
// with one finger while tapping power/mute with another works, since they're
// independent event listeners on separate elements).
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

// Kick off precompilation immediately
powerBtn.disabled = true; // until ready
precompile();
