# Tech

## Quantum simulation

- Amazon Braket local AHS (Rydberg atom) simulator.
- It runs in the browser with Pyodide 0.27.7 (Python 3.12).
- Do not upgrade Pyodide. Newer versions break Braket.

## Engine

- The engine is one Python package.
- The same code runs in the browser and natively for tests.
- Tests use pytest and hypothesis, with `OPENBLAS_NUM_THREADS=1`.

## Web

- A thin TypeScript web worker wraps the Python engine.
- The worker only passes messages. Logic lives in the Python package.

## Dependencies

- Pin every version.
- Self-host all wheels.
- Nothing is fetched from PyPI at runtime.

## Backend

- No backend for now.
- Bedrock comes later through a small Lambda.
