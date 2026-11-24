// Results_Page: renders a validated ResultsFile (ui spec, Requirement 13).
// renderResultsPage is pure. showResults holds the loading and error flow.
// All dynamic text is set with textContent. No sorting, totals or ranking.

import {
  loadResults,
  validateResults,
  type ResultsFile,
  type RunRecord,
  type ValidateResult,
} from '../data/results';
import { CARD_LABELS, CARD_ORDER, CITATION, formatPercent, type EngineName } from '../scoreboard-model';

export const EXAMPLE_NOTICE = 'This is example data, not a measurement.';
export const RESULT_LABEL = 'simulation';
export const BACK_LABEL = 'Back to the map';
export const REPRODUCIBILITY_NOTE =
  "These numbers come from the browser build. The same seed gives the same row in this app. A desktop Python run of the same 30 requests matched in 17 of 30 runs; in the others the hybrid's numbers differed slightly, because of floating point details in the simulation and the atom layout. Annealing and coin flip matched in all 30.";

/** Link back to the map flow, shown in every Results_Page state. */
function backLink(): HTMLAnchorElement {
  const a = el('a', BACK_LABEL, 'back-link');
  a.href = '#/';
  return a;
}

/** "17.5%", "0%". The file stores quantum_share as a percent. One decimal at most. */
export function formatShare(percent: number): string {
  const p = Math.round(percent * 10) / 10;
  return (Number.isInteger(p) ? String(p) : p.toFixed(1)) + '%';
}

/** Plan name as on the cards when `s` is an engine name, else null. */
function planName(s: string): string | null {
  return Object.prototype.hasOwnProperty.call(CARD_LABELS, s) ? CARD_LABELS[s as EngineName] : null;
}

/** A settings key as plain words: "tile_size" becomes "tile size". Engine names show as card names. */
export function formatSettingKey(k: string): string {
  return planName(k) ?? k.replace(/_/g, ' ').toLowerCase();
}

/** A settings value as plain text: "1 to 10", "a, b, c", "key: value". No JSON. */
export function formatSetting(v: unknown, key?: string): string {
  if (typeof v === 'string') return planName(v) ?? v.replace(/_/g, ' ');
  if (typeof v === 'number' && key !== undefined && /share$/i.test(key) && v >= 0 && v <= 1) {
    return formatPercent(v);
  }
  if (Array.isArray(v)) {
    const consecutive =
      v.length >= 3 &&
      v.every((x, i) => Number.isInteger(x) && (i === 0 || x === (v[i - 1] as number) + 1));
    if (consecutive) return `${v[0]} to ${v[v.length - 1]}`;
    return v.map((x) => formatSetting(x)).join(', ');
  }
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${planName(k) ?? k.replace(/_/g, ' ')}: ${formatSetting(x, k)}`)
      .join(', ');
  }
  return String(v);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  return el('td', text, className);
}

/** One row for any status: ok, failed and bad rows all come through here. */
export function renderRunRow(run: RunRecord): HTMLTableRowElement {
  const tr = el('tr', undefined, 'results-row');
  tr.dataset.status = run.status;
  tr.append(cell(String(run.seed), 'num'), cell(run.map));
  for (const name of CARD_ORDER) tr.append(cell(String(run.picks[name]), 'num'));
  for (const name of CARD_ORDER) tr.append(cell(formatShare(run.quantum_share[name]), 'num'));
  tr.append(
    cell(run.atoms_not_needed ? "yes, atoms weren't needed" : 'no'),
    cell(String(run.splits), 'num'),
    cell(String(run.skipped_tiles), 'num'),
    cell(run.reason ? `${run.status}: ${run.reason}` : run.status),
    cell(RESULT_LABEL),
  );
  return tr;
}

function headers(): string[] {
  return [
    'Seed',
    'Map',
    ...CARD_ORDER.map((n) => `Points picked, ${CARD_LABELS[n]}`),
    ...CARD_ORDER.map((n) => `Quantum share, ${CARD_LABELS[n]}`),
    'Atoms not needed',
    'Splits',
    'Skipped tiles',
    'Status',
    'Label',
  ];
}

/** Error state (Req. 13.14): the reason in plain words, no table. */
export function renderResultsError(reason: string): HTMLElement {
  const root = el('main', undefined, 'screen results');
  root.append(el('h1', 'What we measured'), backLink());
  const msg = el('p', `We could not show the results. ${reason}`, 'results-error');
  msg.setAttribute('role', 'alert');
  root.append(msg);
  return root;
}

function renderResultsLoading(): HTMLElement {
  const root = el('main', undefined, 'screen results');
  root.append(el('h1', 'What we measured'), backLink());
  const p = el('p', 'Loading results…', 'muted results-loading');
  p.setAttribute('role', 'status');
  root.append(p);
  return root;
}

/**
 * Mounts the loading state, then the table or the error state.
 * loadResults validates the file, and the result is validated again
 * here so a failure of either step shows a reason and no table.
 */
export async function showResults(
  container: HTMLElement,
  load: () => Promise<ValidateResult> = loadResults,
): Promise<void> {
  container.replaceChildren(renderResultsLoading());
  let outcome: ValidateResult;
  try {
    const loaded = await load();
    outcome = loaded.ok ? validateResults(loaded.value) : loaded;
  } catch {
    outcome = { ok: false, reason: 'The results file could not be loaded.' };
  }
  container.replaceChildren(
    outcome.ok ? renderResultsPage(outcome.value) : renderResultsError(outcome.reason),
  );
}

/** "How these runs were made": date, commit, Chromium, Pyodide. null when the file has none of them. */
export function renderHowMade(file: ResultsFile): HTMLElement | null {
  const items: [string, string | undefined][] = [
    ['Date (UTC)', file.date],
    ['App commit', file.commit],
    ['Chromium', file.chromium],
    ['Pyodide', file.pyodide],
  ];
  const present = items.filter((i): i is [string, string] => i[1] !== undefined);
  if (present.length === 0) return null;
  const section = el('section', undefined, 'results-how');
  section.append(el('h2', 'How these runs were made'));
  const ul = el('ul', undefined, 'results-how-list');
  for (const [k, v] of present) ul.append(el('li', `${k}: ${v}`));
  section.append(ul);
  return section;
}

export function renderResultsPage(file: ResultsFile): HTMLElement {
  const root = el('main', undefined, 'screen results');
  root.append(el('h1', 'What we measured'), backLink());

  if (file.example) {
    const notice = el('p', EXAMPLE_NOTICE, 'results-notice');
    notice.setAttribute('role', 'note');
    root.append(notice);
  }

  const protocol = el('section', undefined, 'results-protocol');
  protocol.append(el('h2', 'Protocol'), el('p', file.protocol.text));
  const dl = el('dl', undefined, 'results-settings');
  for (const [k, v] of Object.entries(file.protocol.settings)) {
    dl.append(el('dt', formatSettingKey(k)), el('dd', formatSetting(v, k)));
  }
  protocol.append(dl);
  root.append(protocol);

  const how = renderHowMade(file);
  if (how) root.append(how);

  const wrap = el('div', undefined, 'results-scroll');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Results table, scrolls sideways');

  const table = el('table', undefined, 'results-table');
  table.append(
    el(
      'caption',
      'One row per run, in file order. Quantum share is the percent of picks that came from the atoms.',
    ),
  );
  const thead = el('thead');
  const hr = el('tr');
  for (const h of headers()) {
    const th = el('th', h);
    th.scope = 'col';
    hr.append(th);
  }
  thead.append(hr);
  const tbody = el('tbody');
  for (const run of file.runs) tbody.append(renderRunRow(run));
  table.append(thead, tbody);
  wrap.append(table);
  root.append(wrap);

  root.append(el('p', REPRODUCIBILITY_NOTE, 'results-repro'));
  root.append(el('p', CITATION, 'muted results-cite'));
  return root;
}
