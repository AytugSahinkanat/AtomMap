---
inclusion: fileMatch
fileMatchPattern: "engine/**/*"
---

# Physics

Settings for the Rydberg atom simulation. Only loaded when working on engine files.

## Constants

- C6 = 5.42e-24 rad·m^6/s
- omega = 15.8e6 rad/s
- Blockade radius = (C6 / omega)^(1/6), about 8.37 µm

## Pulse

- Total duration: 4 µs.
- Amplitude ramps: 0.25 µs (up and down).
- Detuning: linear from -5 omega to +5 omega.
- Phase: 0.

## Simulator

- steps = 400
- shots = 100
- Seed numpy before every run.

## Layout

- At most 10 atoms per call.
- Atoms are at least 4 µm apart. Check this after rounding positions to 0.1 µm.
- A layout must match the conflict graph exactly.
- If a layout does not fit, split the tile in two and try again.
- Never skip a tile because of its layout. Never use 0.5 as a fake value.
- If Braket itself throws an error, the tile can be marked as skipped and the run goes on.
