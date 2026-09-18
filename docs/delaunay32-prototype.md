# Experimental Delaunay32 splitter

This prototype evaluates Delaunay32 0.2.0 as an optional backend for the existing
CDT triangle splitter. It does not change the default legacy splitter or replace
cdt2d. The adapter lives in examples and Delaunay32 is a pinned development dependency.

## Try it

```sh
npm install
npm test
npm run benchmark:delaunay32
npm start
```

Open `/delaunay32.html` on the local Vite server. The browser comparison runs five scenarios against all three splitters. Each case
uses an isolated worker, 10 warmups and 30 measured evaluations, with a 20-second
timeout. The page shows median, p95, volume checks and downloadable raw samples.
Timing excludes WASM loading, geometry preparation and worker messaging. To use the adapter:

```js
import { createDelaunay32 } from 'delaunay32';
import wasmUrl from 'delaunay32/wasm?url'; // Vite asset import
import { Evaluator } from './src/index.js';
import { Delaunay32TriangleSplitter } from './examples/utils/Delaunay32TriangleSplitter.mjs';

const api = await createDelaunay32( { wasmUrl } );
const evaluator = new Evaluator();
evaluator.triangleSplitter = new Delaunay32TriangleSplitter( api );
// evaluator.evaluate(...) remains synchronous.
// Call api.dispose() when the evaluator is no longer needed.
```

## Integration findings

The existing projection, intersection splitting, vertex deduplication, 3D reconstruction
and classification connectivity are reused. A small `triangulate2D` hook selects the
backend. Returned indices reference the original float coordinates, not snapped output.

The polygon boundary must include all subdivision sites along the original triangle's
three sides. Using only corners 0, 1, 2 failed even the crossing-cut and overlapping-box
fixtures: integer rounding can move an intermediate site off its original straight edge,
so the unsplit polygon edge can cross a constraint. Passing the subdivided ring resolves
these fixtures without changing the original output coordinates.

Delaunay32 uses that explicit polygon domain; internal constraints partition it without
being interpreted as holes. This differs from cdt2d's `exterior: false` parity filtering.
The closed internal-loop test checks that the entire original triangle is retained.

Collisions are rejected. Output triangles with nonpositive signed area in the original
coordinates are rejected. There is deliberately no silent fallback to cdt2d: it would
hide failures and could reintroduce the hangs this experiment is intended to investigate.
These checks are not a proof of watertightness or preservation of every near-degenerate
floating-point arrangement.

## Initial measurements

One local macOS arm64 / Node 20.18.0 run, three warmup operations and ten measured
subtractions per case. Median total evaluation time, with prepared brush caches;
WASM initialization is excluded. Each backend/scenario runs in an isolated worker
with a 20-second timeout. Adapter timing includes array conversion and WASM copying.
Raw measurements: `delaunay32-benchmark.jsonl`.

| Case | Legacy | cdt2d | Delaunay32 | CDT calls / operation | Mean sites / call |
| --- | ---: | ---: | ---: | ---: | ---: |
| Offset boxes | 1.49 ms | 2.92 ms | 3.19 ms | 12 | 6.75 |
| Rotated boxes | 1.76 ms | 4.17 ms | 2.86 ms | 18 | 7.50 |
| Offset spheres | 7.82 ms | 12.37 ms | 10.22 ms | 140 | 6.00 |

Delaunay32 and cdt2d produced matching volumes to floating-point rounding and matching
triangle counts in these three cases. Legacy was faster in all three. These are small,
noisy exploratory samples, not a general speed claim or a substitute for browser benchmarks.
The maximum CDT input had nine sites: the million-point Delaunator comparison does not
predict this workload.

## Validation and remaining work

- 43 passing tests, two pre-existing TODOs; 13 new cases cover area, winding, crossing
  and duplicate cuts, internal loops, scaling, collision rejection, classification
  connectivity, and union/intersection/subtraction volumes for coplanar overlapping boxes.
- Lint and TypeScript check pass with 11 pre-existing warnings.
- Library build and Vite examples build pass.
- Browser smoke test reports volume 4 and `passed: true`.

Before considering this for production, reproduce the maintainer's actual degenerate
fixtures; add manifold/shared-edge checks, sliver and near-coplanar stress cases, large
translations and random intersection graphs; and benchmark representative browser scenes.
Neither integer predicates nor these tests establish that all infinite-loop cases are fixed.
The Node test helper supplies a data URL for the browser-oriented package's WASM loader.

## Browser comparison

One local in-app Chromium browser run on September 18, 2026, using the browser
runner above. Times below are median milliseconds, not comparable directly with
the earlier Node run (different warmup/sample counts and simple-box placement).

| Case | Legacy | cdt2d | Delaunay32 | cdt2d / Delaunay32 |
| --- | ---: | ---: | ---: | ---: |
| Coplanar overlapping boxes | 0.50 | 0.70 | 1.00 | 0.70× |
| Rotated boxes | 0.40 | 1.30 | 0.90 | 1.44× |
| Spheres, 24 × 16 segments | 5.50 | 9.90 | 7.80 | 1.27× |
| Spheres, 48 × 32 segments | 11.10 | 21.45 | 16.85 | 1.27× |
| Near-coplanar boxes | 0.60 | 1.05 | 1.10 | 0.95× |

All 15 cases completed. Simple-box volume was within 1e-6 of the expected 4;
other output volumes agreed with legacy within an absolute tolerance of 1e-5.
Volume agreement alone does not establish mesh validity. The near-coplanar case
uses translation (1, 1e-7, 0) and Z rotation 1e-7 radians; it is synthetic and does
not reproduce the maintainer's original infinite-loop reports. Browser timer
resolution and system load make sub-millisecond differences especially noisy.
