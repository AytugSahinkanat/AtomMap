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

- Atoms glow teal `#5dcaa5`. Glow strength = how often the atom was picked in the shots. Soft blur, no flashing.
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
- Two weights only: 400 and 500.
- Numbers use tabular figures.
- Rounded corners 8 to 10 px.
- No heavy shadows. No gradients, except the atom glow.

## Motion

- Transitions about 300 ms.
- A picked point locks in with a small pulse. Its neighbours fade out.
- With `prefers-reduced-motion`: no pulses, no glow animation. Show the final state only.

## Words

- Plain English, short sentences, no hype.
- Say "simulation", not "quantum computer".
