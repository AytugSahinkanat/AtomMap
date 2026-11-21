// Placeholder Map_Screen. Task 7.4 replaces this module.
// Task 6.6 adds the Place_Mode preset selector (radio group, loading, error).

import { loadPlace } from "../data/fixtures";
import { PLACES, type PlaceName } from "../settings";
import { state, update } from "../state";

function createPlaceSelector(): HTMLElement {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "place-selector";
  const legend = document.createElement("legend");
  legend.textContent = "Place";
  fieldset.append(legend);

  const status = document.createElement("p");
  status.className = "muted place-status";
  status.setAttribute("role", "status");

  const error = document.createElement("p");
  error.className = "error place-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const inputs = new Map<PlaceName, HTMLInputElement>();
  for (const place of PLACES) {
    const label = document.createElement("label");
    label.className = "place-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "place";
    input.value = place.name;
    input.addEventListener("change", () => void select(place.name));
    inputs.set(place.name, input);
    label.append(input, " ", place.label);
    fieldset.append(label);
  }
  // Attribution, cafe count and fetch date of the loaded place (Task 6.7).
  const attribution = document.createElement("p");
  attribution.className = "muted place-attribution";
  attribution.hidden = true;
  const copyright = document.createElement("span");
  const licenceLink = document.createElement("a");
  licenceLink.rel = "noopener noreferrer";
  licenceLink.target = "_blank";
  const countText = document.createElement("span");
  const dateText = document.createElement("span");
  attribution.append(copyright, " (", licenceLink, "). ", countText, ". ", dateText, ".");

  fieldset.append(status, error, attribution);

  function renderAttribution(): void {
    const f = state.placeFixture;
    if (f === null) {
      attribution.hidden = true;
      return;
    }
    copyright.textContent = "© OpenStreetMap contributors";
    licenceLink.textContent = f.source.licence;
    licenceLink.href = /^https?:\/\//i.test(f.source.licence_url) ? f.source.licence_url : "";
    countText.textContent = `${f.counts.points} cafes`;
    dateText.textContent = `Fetched ${f.source.fetched_at}`;
    attribution.hidden = false;
  }

  function render(): void {
    renderAttribution();
    for (const [name, input] of inputs) input.checked = state.placeName === name;
    status.textContent = state.placeLoading ? "Loading the map…" : "";
    error.hidden = state.placeError === null;
    error.textContent = state.placeError ?? "";
  }

  async function select(name: PlaceName): Promise<void> {
    // Clear the previous result and show the loading state. Both places stay selectable.
    update({
      placeName: name,
      placeFixture: null,
      placeLoading: true,
      placeError: null,
      result: null,
    });
    render();
    try {
      const fixture = await loadPlace(name);
      if (state.placeName !== name) return; // a newer choice won
      update({ placeFixture: fixture, placeLoading: false });
    } catch (e) {
      if (state.placeName !== name) return;
      update({
        placeLoading: false,
        placeError: e instanceof Error ? e.message : String(e),
      });
    }
    render();
  }

  render();
  return fieldset;
}

export function createMapScreen(): HTMLElement {
  const el = document.createElement("main");
  el.className = "screen map";
  const h = document.createElement("h1");
  h.textContent = "AtomMap";
  const p = document.createElement("p");
  p.textContent = "The simulator is ready. The map comes next.";
  el.append(h, p, createPlaceSelector());
  return el;
}
