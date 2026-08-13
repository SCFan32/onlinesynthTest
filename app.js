import {
  instantiateFaustModuleFromFile,
  LibFaust,
  FaustCompiler,
  FaustMonoDspGenerator,
} from "./faustwasm-bundle.js";

const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");

let audioContext = null;
let started = false;

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function loadDspSource() {
  const res = await fetch("./fm.dsp");
  return await res.text();
}

async function startAudio() {
  if (started) return;
  started = true;
  startBtn.disabled = true;
  setStatus("Loading Faust compiler…");

  try {
    // 1. Boot the in-browser Faust compiler (compiles .dsp -> wasm at runtime)
    const faustModule = await instantiateFaustModuleFromFile("./libfaust/libfaust-wasm.js");
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);

    // 2. Create the audio context (must happen after a user gesture)
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();

    // 3. Compile the DSP source and create a mono AudioWorklet node
    setStatus("Compiling DSP…");
    const dspCode = await loadDspSource();

    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, "fmSynth", dspCode, "");

    const node = await generator.createNode(audioContext);
    if (!node) throw new Error("Failed to create audio node");

    node.connect(audioContext.destination);

    setStatus("Playing — FM sine with sweep");
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message);
    started = false;
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", startAudio);
