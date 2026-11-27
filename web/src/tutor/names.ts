// Point names in the Tutor's text (place maps). The Facts keep ids; just before the sentences are
// built, the id fields that are written out are swapped for the Point's name, the id when it has
// none. The rings stay ids, so the map rings the same Points. No fact is added or removed, so the
// sentences need exactly the same facts as before.

import type { Facts, WhyFacts } from "./facts";

export type PointLabel = (id: string) => string;

/** The label of a names map: the name, else the id. */
export function labelFrom(names?: ReadonlyMap<string, string>): PointLabel {
  return (id) => names?.get(id) ?? id;
}

/** Facts with the written-out ids named. Rings and every other field are unchanged. */
export function nameFacts(f: Facts, label: PointLabel): Facts {
  const out: Facts = { ...f };
  if (f.rulesFirst && f.rulesFirst.first !== undefined) out.rulesFirst = { ...f.rulesFirst, first: label(f.rulesFirst.first) };
  if (f.group) {
    const [a, b] = f.group.top;
    out.group = { ...f.group, top: b === undefined ? [label(a)] : [label(a), label(b)] };
  }
  if (f.atomPick) out.atomPick = { ...f.atomPick, id: label(f.atomPick.id) };
  return out;
}

/** A Why_Answer's facts with its Point and the picked neighbours named. The ring stays ids. */
export function nameWhy(w: WhyFacts, label: PointLabel): WhyFacts {
  return { ...w, id: label(w.id), rounds: w.rounds.map((r) => (r.by === undefined ? { ...r } : { ...r, by: label(r.by) })) };
}
