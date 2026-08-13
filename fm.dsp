import("stdfaust.lib");

// --- FM synth, controlled via 2 params: carrier frequency and FM index ---
// Modulator frequency is derived from the carrier via a fixed ratio,
// slightly detuned off an integer for a bit of movement/beating.

carrierFreq = hslider("carrierFreq", 300, 40, 1500, 0.01) : si.smoo;
modIndex    = hslider("modIndex", 4, 1, 200, 0.01) : si.smoo;

modFreqRatio = 3.01;
//modFreq = carrierFreq * modFreqRatio;
modFreq = modIndex;

//modulator = os.osc(modFreq) * modIndex * carrierFreq;
modulator = os.osc(modFreq) * 400;
fmVoice   = os.osc(carrierFreq + modulator);

gain = 0.25;

process = fmVoice * gain <: si.bus(2); // duplicate to stereo
