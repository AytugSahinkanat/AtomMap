# Product

AtomMap is a web app that brings people who have never touched quantum computing a bit closer to it, using a map.

## Idea

The user places points on a map: wifi access points, cafes, street corners, anything. Two points that are too close to each other cannot both be picked. The goal is to pick as many points as possible. This is the Maximum Independent Set (MIS) problem on a proximity graph.

## Method

We use qReduMIS (Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5, CC BY 4.0). We write our own implementation and cite the paper in the app and the repo.

## Modes

- **Channel plan**: the wifi hall, 3 rounds. One round per 2.4 GHz channel (1, 6, 11). Each round picks an independent set of APs, and those APs get that channel. APs not picked in any round go 5 GHz only.
- **Place**: one round, for things like kiosks or stations. The preset is about 300 Kadikoy cafes with a 150 m walking rule on real streets.

Each mode has one distance toggle:
- Channel plan: walls on/off.
- Place: walking distance vs straight line.

## Hero map

A wifi hall with 70 access points on a 9 m grid. Two APs close enough to interfere cannot share a channel, so each round's independent set shows which APs can safely reuse that channel.

## Scoreboard

The core of the app. Four competitors run on the same map and are shown side by side:

1. Atoms alone. Only the atoms, no classical rules, so the result can leave gaps.
2. Atoms + classical rules (the hybrid, qReduMIS).
3. Annealing + rules.
4. Coin flip + rules.

The quantum share is always shown: how many picks came from the atoms.

## Later

A small AI tutor on Amazon Bedrock explains each run in plain language.

## Audience

Curious non-experts. No quantum background assumed. Explain in plain words, show results on the map first and the theory second.

## Hackathon

Kiroween, Frankenstein category.
