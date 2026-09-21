import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

const backends = [ 'cdt2d', 'cdt2d-domain', 'delaunay32' ];
const median = values => {

	const sorted = values.slice().sort( ( a, b ) => a - b );
	const mid = Math.floor( sorted.length / 2 );
	return sorted.length % 2 ? sorted[ mid ] : ( sorted[ mid - 1 ] + sorted[ mid ] ) / 2;

};

export async function writeReport() {

	const report = JSON.parse( await readFile( new URL( '../../docs/robustness/results.json', import.meta.url ), 'utf8' ) );
	const lines = [ '# CDT / Delaunay32 robustness study', '',
		`Recorded ${ report.date } on ${ report.cpu }, ${ report.platform } ${ report.arch }, ${ report.node }.`, '',
		'## What was compared', '',
		'- **cdt2d:** the current integration, using `exterior: false`.',
		'- **cdt2d-domain:** a direct-test control using all finite faces. Every direct domain is convex and contains all input sites, so this covers the same domain as the Delaunay32 polygon. This control is not used for full CSG and is not proposed as an integration fix.',
		'- **delaunay32:** version 0.2.0; explicit polygon domain, native Int32 input for integer fixtures, automatic quantization with collision rejection for float fixtures. Full CSG uses the existing experimental adapter.', '',
		'## Correctness results', '',
		'“Pass” means the specified invariants passed, not a proof of correctness for all inputs. Invalid-input behavior is listed separately and excluded from valid-input scores.', '',
		'| Corpus | Backend | Cases | Checks pass | Output fails checks | Rejected | Timeout / crash |',
		'| --- | --- | ---: | ---: | ---: | ---: | ---: |',
	];
	const groups = {
		'Valid integer graphs': c => c.fixture.kind === 'direct' && c.fixture.expectedValid && c.fixture.encoding === 'integer',
		'Valid float graphs': c => c.fixture.kind === 'direct' && c.fixture.expectedValid && c.fixture.encoding === 'float',
		'Full CSG': c => c.fixture.kind === 'csg',
	};
	for ( const [ label, filter ] of Object.entries( groups ) ) {

		const cases = report.cases.filter( filter );
		for ( const backend of backends ) {

			const results = cases.map( c => c.results[ backend ] ).filter( Boolean );
			if ( ! results.length ) continue;
			const count = status => results.filter( r => r.status === status ).length;
			lines.push( `| ${ label } | ${ backend } | ${ results.length } | ${ count( 'checks-pass' ) } | ${ count( 'invalid-output' ) } | ${ count( 'rejected' ) } | ${ count( 'timeout' ) + count( 'worker-error' ) } |` );

		}

	}

	lines.push( '', '## Findings', '',
		'- The domain-matched direct comparison does not establish a robustness advantage for Delaunay32. Read the counts above together with its finite-grid limitation.',
		'- Current cdt2d parity filtering omits regions in some subdivided grids and internal-loop fixtures. These are domain-semantics differences, not evidence of an arithmetic failure in cdt2d. Keeping all finite faces passes the independent direct checker on the corresponding convex inputs.',
		'- Delaunay32 rejects five valid float inputs: `sliver-32`, `sliver-40`, `close-pair-32`, `close-pair-40`, and `close-pair-48`. The error is “quantization produced coincident points”. This is a deliberate safe rejection, but those inputs remain usable by cdt2d.',
		'- Both CSG integrations fail the analytic volume check for `thin-5.960464477539063e-8`: expected about 9.894371e-8, observed about 3.298124e-8. The shared `isTriDegenerate` predicate classifies 8 of the 12 input box triangles as degenerate at this thickness; that predicate gates intersection collection and whole-triangle output. This exposes a shared pipeline limitation, not an advantage for either triangulator.',
		'- No infinite-loop case was reproduced in this corpus. No claim is made about Garrett’s original input.', '',
		'## Performance', '',
		'Each direct sample averages 64 calls; each CSG sample is one whole evaluation. Ten warmups precede 21 samples. Values below are medians of sample medians (four seeds for clouds, one deterministic fixture for grids and CSG). Calls include adapter conversion/copy overhead, but exclude input generation, independent validation, worker messaging and WASM initialization. CSG geometry caches and output buffers are warm. Only cases passing the relevant checks are timed.', '',
		'| Workload | cdt2d ms | cdt2d-domain ms | Delaunay32 ms |',
		'| --- | ---: | ---: | ---: |' );
	const timedGroups = new Map();
	for ( const entry of report.cases.filter( c => c.fixture.performance ) ) {

		const f = entry.fixture;
		const name = f.family === 'integer-cloud' ? `Boundary-only cloud: ${ f.points.length } integer sites` : f.family === 'float-cloud' ? 'Boundary-only cloud: 15 float sites' : f.id;
		if ( ! timedGroups.has( name ) ) timedGroups.set( name, [] );
		timedGroups.get( name ).push( entry );

	}

	for ( const [ name, cases ] of timedGroups ) {

		const values = backends.map( backend => {

			const timings = cases.map( c => c.results[ backend ]?.timing?.medianMs ).filter( n => n !== undefined );
			return timings.length ? median( timings ).toFixed( 4 ) : '—';

		} );
		lines.push( `| ${ name } | ${ values.join( ' | ' ) } |` );

	}

	lines.push( '', 'Larger boundary-only clouds are not the typical CSG workload: most splitter calls previously measured had only 6–8 sites. The constrained grids and full CSG timings are important counterpoints. This is a local Node benchmark, not a browser performance claim.', '',
		'## Validation and limitations', '',
		'- **Direct input:** checks duplicate sites, zero-length/duplicate edges, unsplit crossings and T-junctions, convex-domain containment and boundary constraints before executing a backend.',
		'- **Direct output:** independent BigInt arithmetic on the exact dyadic values represented by the input doubles checks triangle orientation, duplicate faces, every constraint/site, exact total area, boundary/interior edge incidence, opposite winding on shared edges, edge crossings, T-junctions and sites strictly inside a triangle. Different valid triangulations are accepted. Inputs are checked against the original geometry, not the snapped geometry.',
		'- **Full CSG:** checks finite vertices, zero-area faces, signed volume and analytic volume for 18 axis-aligned box cases (tolerance: 1e-6 times original box volume). Other scenes have basic mesh checks but no independent exact shape oracle. Exact unmatched-edge counts are diagnostics only because subdivision/T-junctions and rounding can also cause mismatches. These tests do not prove watertightness, surface coverage or absence of self-intersections.',
		'- **Invalid inputs:** five fixtures are outside cdt2d’s contract. No score is assigned to them. Delaunay32 may deliberately normalize duplicates or split a constraint through an existing site; the strict checker’s missing-site/edge flags are not evidence that such normalization is wrong. Raw outcomes and diagnostics are retained.',
		'- Workers execute sequentially; backend order rotates by fixture. A stuck case is terminated after 10 seconds and the worker is replaced. The corpus is bounded and synthetic, not an exhaustive proof or a reproduction of previously reported failures.', '',
		'## Reproduce', '', '```sh', 'npm run benchmark:robustness', 'npm run benchmark:robustness -- --case close-pair-32', 'npm run benchmark:robustness -- --case thin-5.960464477539063e-8', '```', '',
		'Full runs write `results.json` and this report; a selected case writes `replay.json` without overwriting the full study. Every fixture, seed, timing sample, error and validation outcome is saved. Failed CSG cases also retain the 2D splitter inputs. Checker tests deliberately plant gaps, overlaps, duplicate faces and missing constraints.', '' );
	await writeFile( new URL( '../../docs/robustness/README.md', import.meta.url ), lines.join( '\n' ) );

}

if ( process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href ) {

	writeReport().catch( error => {

		console.error( error ); process.exitCode = 1;

	} );

}
