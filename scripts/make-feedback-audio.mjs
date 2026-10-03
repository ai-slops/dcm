import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const output = process.argv[2];
if (!output || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/make-feedback-audio.mjs <new-output.wav>");
}

const sampleRate = 8000;
const samples = sampleRate * 4;
const wave = Buffer.alloc(44 + samples * 2);
wave.write("RIFF", 0);
wave.writeUInt32LE(wave.length - 8, 4);
wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(sampleRate, 24);
wave.writeUInt32LE(sampleRate * 2, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write("data", 36);
wave.writeUInt32LE(samples * 2, 40);

const beatMicros = [100000, 600000, 1100000, 1600000, 2100000, 2500000, 2900000, 3300000];
for (const time of beatMicros) {
  const start = time * sampleRate / 1000000;
  for (let offset = 0; offset < 80; offset += 1) {
    wave.writeInt16LE(offset % 8 < 4 ? 4000 : -4000, 44 + (start + offset) * 2);
  }
}

writeFileSync(output, wave, { flag: "wx", mode: 0o644 });
console.log(JSON.stringify({
  audio_digest: createHash("sha256").update(wave).digest("hex"),
  duration_micros: 4000000,
  offset_micros: 100000,
  ticks_per_beat: 4,
  chart_duration_ticks: 32,
  tempo_change_tick: 16,
  beat_micros: beatMicros,
}));
