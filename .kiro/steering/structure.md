# Structure

```
engine/          Python package (the whole engine)
  pyproject.toml
  src/atommap/
  tests/         pytest + hypothesis, next to the package
worker/          TypeScript web worker, thin wrapper around the engine
web/             UI (map, scoreboard)
fixtures/        Map data as files: wifi hall, Kadikoy cafes and streets
wheels/          Self-hosted pinned wheels, served to Pyodide
docs/            Paper citation, notes
.kiro/steering/  Steering docs
```

## Rules

- All logic lives in `engine/`. `worker/` and `web/` hold no algorithm code.
- Fixtures are committed files. Nothing is fetched live, including street data.
- Wheels in `wheels/` are the only source of Python packages in the browser.
- Engine tests run natively, not in the browser.
