import("stdfaust.lib");

// --- Minimal FM synth with a frequency sweep ---
// Carrier frequency sweeps between two bounds using a slow LFO.
// Modulator frequency and index shape the FM sidebands.

carrierMin = 150;
carrierMax = 600;
sweepRate  = 0.1; // Hz, one sweep cycle every 10s

carrierFreq = carrierMin + (carrierMax - carrierMin) * (os.osc(sweepRate) * 0.5 + 0.5);

modFreqRatio = 3.01;   // modulator freq relative to carrier (slightly detuned for movement)
modIndex     = 4;      // FM index (modulation depth)

modFreq = carrierFreq * modFreqRatio;
modulator = os.osc(modFreq) * modIndex * carrierFreq;

fmVoice = os.osc(carrierFreq + modulator);

gain = 0.25;

process = fmVoice * gain <: si.bus(2); // duplicate to stereo
