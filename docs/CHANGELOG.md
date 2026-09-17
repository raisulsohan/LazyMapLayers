# Changelog

## Unreleased — Phase 0 (foundation and spikes)

- **Project scaffold.**
  - CEP manifest for AE 24+.
  - esbuild panel bundle with MapLibre GL JS 6.10 and its worker loaded from a blob.
  - Concatenated ES3 host script.
  - Dev install through a junction.
- **Core maths** (pure TypeScript, run directly by Node 24):
  - Web Mercator helpers.
  - A closed-form, MapLibre-compatible perspective camera (project, unproject, horizon).
  - The van Wijk–Nuij smooth zoom-and-pan fly path.
- **PMTiles v3 writer**, with tile de-duplication, run-length entries and leaf directories. It is
  verified against the official `pmtiles` reader.
- **PNG encoder** for rendered frames, plus WebGL read-back conversion (flip and unpremultiply).
- **Offline world basemap** built from Natural Earth: z0–6, 10 layers, and country names in 26
  languages.
- **Panel.**
  - An offline preview map.
  - "Create map comp", which makes a tagged precomp with Latitude, Longitude, Zoom, Bearing and
    Pitch controls.
  - "Keyframe view".
  - A spike runner.
- **Host.**
  - A JSON implementation that keeps its output ASCII.
  - `LML.call` with structured errors.
  - Undo groups on every action.
  - `LML:` tags that preserve the user's own comments.
- **Tooling.**
  - `npm run verify` (unit tests, typecheck, build, ES3 host checks).
  - `npm run ae:spikes` runs S1, S2a, S3, S5 and S6 inside the real After Effects.
