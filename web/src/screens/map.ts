// Placeholder Map_Screen. Task 7.4 replaces this module.

export function createMapScreen(): HTMLElement {
  const el = document.createElement("main");
  el.className = "screen map";
  const h = document.createElement("h1");
  h.textContent = "AtomMap";
  const p = document.createElement("p");
  p.textContent = "The simulator is ready. The map comes next.";
  el.append(h, p);
  return el;
}
