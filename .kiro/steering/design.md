---
inclusion: fileMatch
fileMatchPattern: "web/**"
---

# Design

Look: "night lab". Dark, calm, science not horror. Kiroween dark mode, but serious.

## Colours

- Background `#0b0d17`
- Panels `#11142a`
- Borders `#262a4d`, thin (0.5 to 1 px)
- Text `#e8e6f5`
- Muted text `#8f8cb8`
- Accent `#7f77dd` for buttons and focus
- Text contrast at least AA on the dark background

## Map

- Atoms glow teal `#5dcaa5`. Glow strength = how often the atom was picked in the shots. Soft blur.
- No flashing for effect. The one exception is the shot replay: an atom kept in a replayed shot brightens for a moment, because that shot really kept it. Flashes stay on the small atoms, never a large area or the whole screen. An atom flashes at most 3 times a second (the usual safe limit for flashing), and never with `prefers-reduced-motion`.
- Channels use colour AND shape, for colour blind users:
  - 1: purple circle
  - 6: amber `#ef9f27` triangle
  - 11: teal square
  - 5 GHz only: hollow grey circle
- Tiles are dashed "stitch" outlines (the Frankenstein nod), shown only while the atoms work on them.
- Conflict lines are very thin and dim. They are background.

## Scoreboard

- The 4 cards look exactly the same. No winner colour, no crown, no glow on the hybrid.
- The quantum share bar is the same teal on all cards.

## Type and shape

- One font: the system ui stack. No web fonts.
- The one exception is the lab: its labels and readouts may use the system monospace stack (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`). Still no web fonts, and nowhere else.
- Two weights only: 400 and 500.
- Numbers use tabular figures.
- Rounded corners 8 to 10 px.
- No heavy shadows. No gradients, except the atom glow.

## Motion

- Motion may be rich when it shows real data: the atoms of a group, their blockade halos, the laser sweep while a group is simulated, the replay of the real shots, the glow building up to the real frequency. It is never decoration, and it never shows made-up data: no extra shots, no invented frequencies, no halo on a point that is not on the atoms.
- Scene changes: the outgoing scene fades out while it scales down slightly (to 0.98) and blurs, about 260 ms. The parts of the new scene come in one after another, each fading in while it rises about 14 px, about 460 ms each, 60 ms apart, ease-out, no bounce or overshoot.
- A map card opens its map with a container transform: the card preview grows into the map box, about 520 ms, same ease-out.
- No clicks while a transition runs.
- A picked point locks in with a small pulse. Its neighbours fade out.
- With `prefers-reduced-motion`: no pulses, no glow animation, no scene transitions. Show the final state only. This always works, in every scene and in the lab.

## Lab

- Darker than the rest of the app: background `#07080f`, with a faint measurement grid (1 px lines every 24 px, about 6% opacity).
- Monospace labels and readouts (see Type and shape). Small line icons in the palette: flask, sliders, test tubes, gauge.
- Entering it may take about 1 s (the flask fills, three bubbles rise). Calm, no bounce, nothing cartoonish.

## Words

- Plain English, short sentences, no hype.
- Say "simulation", not "quantum computer".
