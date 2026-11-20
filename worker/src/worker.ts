// AtomMap worker loader (task 1.4).
//
// Classic worker (uses importScripts for pyodide.js). It only loads things and
// passes messages. It has no MIS logic. All logic lives in the Python package.
//
// Load order (stage names are what the UI sees):
//   pyodide   load pyodide.js and the runtime (self-hosted)  0..25 %
//   engine    fetch the atommap source files, check sha256,
//             write them into Pyodide's site-packages        25..35 %
//   packages  boot.install_packages: verify wheels, then
//             load the built-in packages                     35..60 %
//   boot      install the pinned wheels, fake numba,
//             Lean_Mode stubs                                60..90 %
//   warmup    tiny simulation with the real Braket simulator 90..100 %
// Then "ready". On any failure: "error" and stop.
//
// Options come from the worker URL query string:
//   ?lean=0|1   Lean_Mode (default 1)
//   ?root=URL   site root that holds web/engine and wheels
//               (default: two levels above this file, i.e. the repo root when
//               the file is at <root>/worker/dist/worker.js)
//
// Every log line starts with "[atommap-worker][stage]".

/* eslint-disable @typescript-eslint/no-explicit-any */

declare function loadPyodide(options: {
  indexURL: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}): Promise<PyodideApi>;

interface PyodideApi {
  FS: any;
  runPython(code: string): any;
  runPythonAsync(code: string): Promise<any>;
  registerJsModule(name: string, module: object): void;
  globals: { set(name: string, value: any): void };
}

const T0 = performance.now();
const params = new URL(self.location.href).searchParams;
const LEAN = params.get("lean") !== "0";
// Two layouts, both resolved against this file's URL (no absolute paths):
//   built site  <site>/worker.js        -> <site>/engine, <site>/wheels, <site>/pyodide
//   repo        <repo>/worker/dist/worker.js (smoke.html) -> <repo>/web/engine, <repo>/wheels, <repo>/pyodide
const REPO_LAYOUT = /\/worker\/dist\/worker\.js$/.test(new URL(self.location.href).pathname);
const ROOT = new URL(params.get("root") ?? (REPO_LAYOUT ? "../../" : "./"), self.location.href).href;
// Pyodide 0.27.7 core and its built-in packages are self-hosted too. scripts/fetch_pyodide.py
// downloads them at build time into pyodide/. Nothing is fetched from a CDN at runtime.
const PYODIDE_URL = ROOT + "pyodide/";
const ENGINE_URL = ROOT + (REPO_LAYOUT ? "web/engine/" : "engine/");
const WHEELS_URL = ROOT + "wheels/";

let currentStage: LoadStage = "pyodide";
let lastPercent = 0;

function log(stage: string, text: string): void {
  console.log(`[atommap-worker][${stage}] ${text}`);
}

function post(msg: FromWorkerMessage): void {
  (self as any).postMessage(msg);
}

/** Send a loading progress event. The percent never goes down. */
function progress(stage: LoadStage, percent: number, detail?: string): void {
  currentStage = stage;
  lastPercent = Math.max(lastPercent, Math.min(100, Math.round(percent)));
  const payload: ProgressLoadPayload = { stage, percent: lastPercent };
  if (detail !== undefined) payload.detail = detail;
  log(stage, `${lastPercent}%${detail ? " " + detail : ""}`);
  post({ type: "progress", payload });
}

class LoadError extends Error {
  dependency?: string;
  constructor(message: string, dependency?: string) {
    super(message);
    this.name = "LoadError";
    this.dependency = dependency;
  }
}

function fail(err: unknown): void {
  const e = err as any;
  const payload: ErrorPayload = {
    type: typeof e?.type === "string" ? e.type : (e?.name ?? "Error"),
    message: String(e?.message ?? e),
    stage: currentStage,
  };
  if (e?.dependency) payload.dependency = String(e.dependency);
  console.error(`[atommap-worker][${currentStage}] FAILED`, payload, e?.stack ?? "");
  post({ type: "error", payload });
}

async function fetchChecked(url: string, what: string, dependency: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new LoadError(`${what}: fetch failed for ${url} (${e})`, dependency);
  }
  if (!res.ok) {
    throw new LoadError(`${what}: HTTP ${res.status} for ${url}`, dependency);
  }
  return res;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- stage: pyodide -------------------------------------------------------

async function loadRuntime(): Promise<PyodideApi> {
  progress("pyodide", 0, "load pyodide.js from " + PYODIDE_URL);
  try {
    importScripts(PYODIDE_URL + "pyodide.js");
  } catch (e) {
    throw new LoadError(`could not load ${PYODIDE_URL}pyodide.js (${e})`, "pyodide");
  }
  progress("pyodide", 10, "pyodide.js loaded, starting runtime");
  try {
    const py = await loadPyodide({
      indexURL: PYODIDE_URL,
      stdout: (line) => console.log("[python]", line),
      stderr: (line) => console.error("[python]", line),
    });
    progress("pyodide", 25, "runtime ready");
    return py;
  } catch (e) {
    throw new LoadError(`loadPyodide failed (${e})`, "pyodide");
  }
}

// --- stage: engine --------------------------------------------------------

async function installEngineFiles(py: PyodideApi): Promise<void> {
  progress("engine", 25, "fetch engine-files.json");
  const listRes = await fetchChecked(ENGINE_URL + "engine-files.json", "engine file list", "atommap");
  const list = (await listRes.json()) as {
    format: number;
    files: { path: string; sha256: string }[];
  };
  if (list.format !== 1 || !Array.isArray(list.files) || list.files.length === 0) {
    throw new LoadError("engine-files.json has an unexpected format", "atommap");
  }
  const site: string = py.runPython("import sysconfig; sysconfig.get_path('purelib')");
  const target = site + "/atommap";
  py.FS.mkdirTree(target);
  for (let i = 0; i < list.files.length; i++) {
    const f = list.files[i];
    const res = await fetchChecked(ENGINE_URL + "atommap/" + f.path, "engine file", "atommap/" + f.path);
    const bytes = await res.arrayBuffer();
    const got = await sha256Hex(bytes);
    if (got !== f.sha256) {
      throw new LoadError(
        `sha256 mismatch for atommap/${f.path} (expected ${f.sha256}, got ${got}). ` +
          "Re-run scripts/build_engine_bundle.py.",
        "atommap/" + f.path,
      );
    }
    const slash = f.path.lastIndexOf("/");
    if (slash > 0) py.FS.mkdirTree(target + "/" + f.path.slice(0, slash));
    py.FS.writeFile(target + "/" + f.path, new Uint8Array(bytes));
    progress("engine", 25 + (10 * (i + 1)) / list.files.length, f.path);
  }
  py.runPython("import importlib; importlib.invalidate_caches()");
  log("engine", `wrote ${list.files.length} files to ${target}`);
}

// --- stages: packages + boot ---------------------------------------------

// Python glue, kept tiny: calls boot.install_packages and turns a BootError
// into a JSON string so the dependency name reaches the UI.
const BOOT_GLUE = `
import json
import atommap_host as h
from atommap import boot

async def _read_wheel(name):
    data = await h.read_wheel(name)
    if data is None:
        return None
    return bytes(data.to_py())

async def _atommap_boot():
    try:
        await boot.install_packages(
            h.manifest_text, _read_wheel, bool(h.lean), progress=h.progress
        )
    except boot.BootError as exc:
        return json.dumps({"dependency": exc.dependency, "message": str(exc)})
    return ""

await _atommap_boot()
`;

// install_packages reports sub-stages verify, builtins, wheels (0..100 each).
function mapBootProgress(sub: string, pct: number): void {
  if (sub === "verify") progress("packages", 35 + pct * 0.05, "verify wheels");
  else if (sub === "builtins") progress("packages", 40 + pct * 0.2, "built-in packages");
  else if (sub === "wheels") progress("boot", 60 + pct * 0.25, "install wheels");
  else log(currentStage, `unknown install_packages stage ${sub} ${pct}`);
}

async function bootPackages(py: PyodideApi): Promise<void> {
  progress("packages", 35, "fetch wheels/manifest.json");
  const manifestRes = await fetchChecked(WHEELS_URL + "manifest.json", "wheel manifest", "manifest");
  const manifestText = await manifestRes.text();

  py.registerJsModule("atommap_host", {
    manifest_text: manifestText,
    lean: LEAN,
    progress: (sub: string, pct: number) => mapBootProgress(sub, pct),
    read_wheel: async (filename: string): Promise<Uint8Array | null> => {
      const res = await fetch(WHEELS_URL + filename);
      if (!res.ok) {
        log("packages", `wheel ${filename}: HTTP ${res.status}`);
        return null; // boot.py turns this into a BootError naming the dependency
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  });

  let outcome: string;
  try {
    outcome = await py.runPythonAsync(BOOT_GLUE);
  } catch (e) {
    // Not a BootError: e.g. loadPackage of a built-in failed.
    const err = e as any;
    err.dependency = err.dependency ?? (currentStage === "packages" ? "builtin-packages" : undefined);
    throw err;
  }
  if (outcome) {
    const info = JSON.parse(outcome) as { dependency: string; message: string };
    const err = new LoadError(info.message, info.dependency);
    err.name = "BootError";
    throw err;
  }

  progress("boot", 85, "fake numba");
  py.runPython("from atommap import boot; boot.install_fake_numba()");
  if (LEAN) {
    progress("boot", 88, "Lean_Mode import stubs");
    py.runPython("from atommap import boot; boot.install_lean_stubs()");
  }
  progress("boot", 90, "done");
}

// --- stage: warmup --------------------------------------------------------

function warmup(py: PyodideApi): void {
  progress("warmup", 90, "import braket and run a 2-atom simulation");
  const t = performance.now();
  const shots = py.runPython(`
from atommap.simulator import BraketSimulator
len(BraketSimulator().run_tile([(0.0, 0.0), (6.0, 0.0)], 1))
`);
  progress("warmup", 100, `${shots} shots in ${Math.round(performance.now() - t)} ms`);
}

// --- main -----------------------------------------------------------------

async function main(): Promise<void> {
  log("start", `lean=${LEAN} root=${ROOT}`);
  const py = await loadRuntime();
  pyRef = py;
  await installEngineFiles(py);
  await bootPackages(py);
  warmup(py);
  const elapsedMs = Math.round(performance.now() - T0);
  log("ready", `${elapsedMs} ms`);
  ready = true;
  post({ type: "ready", payload: { elapsedMs, lean: LEAN } });
}

// --- run (task 10.3) --------------------------------------------------------
// The worker only passes messages. The request goes to atommap.api.run as one
// JSON string; engine run events go back as "progress" messages unchanged.

let pyRef: PyodideApi | null = null;
let ready = false;
let running = false;

// Tiny Python glue: events become JSON text so the worker needs no PyProxy handling.
const RUN_GLUE = `
import json
import atommap_run_host as rh
from atommap.api import run as _run

_run(_atommap_request, lambda ev: rh.emit(json.dumps(ev)))
`;

function runLog(text: string): void {
  console.log(`[atommap-worker][run] ${text}`);
}

function postError(type: string, message: string): void {
  post({ type: "error", payload: { type, message } });
}

async function handleStart(request: unknown): Promise<void> {
  if (!ready || !pyRef) return postError("NotReady", "engine is still loading");
  if (running) return postError("Busy", "a run is already in progress");
  running = true;
  const t = performance.now();
  try {
    const py = pyRef;
    py.registerJsModule("atommap_run_host", {
      emit: (eventJson: string) => post({ type: "progress", payload: JSON.parse(eventJson) }),
    });
    py.globals.set("_atommap_request", JSON.stringify(request));
    const text: string = await py.runPythonAsync(RUN_GLUE);
    let out: any;
    try {
      out = JSON.parse(text);
    } catch (e) {
      return postError("BadEngineOutput", `engine output is not JSON (${e})`);
    }
    runLog(`finished ok=${out?.ok} in ${Math.round(performance.now() - t)} ms`);
    if (out?.ok === true) post({ type: "result", payload: out.result });
    else if (out?.ok === false) post({ type: "error", payload: out.error });
    else postError("BadEngineOutput", "engine output has no boolean ok");
  } catch (e) {
    console.error("[atommap-worker][run] FAILED", e);
    postError("PythonError", String((e as any)?.message ?? e));
  } finally {
    running = false;
  }
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as ToWorkerMessage;
  if (msg && msg.type === "start") {
    runLog("start received");
    void handleStart(msg.payload);
  } else {
    console.warn("[atommap-worker] unknown message ignored:", ev.data);
  }
};

main().catch(fail);
