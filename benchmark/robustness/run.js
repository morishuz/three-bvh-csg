import { Worker } from 'node:worker_threads';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { directCorpus, csgCorpus } from './corpus.js';
import { validateInput } from './geometry.js';
import { writeReport } from './report.js';

const backends = [ 'cdt2d', 'cdt2d-domain', 'delaunay32' ];
const timeoutMs = 10000;

async function startWorker( backend ) {

	const worker = new Worker( new URL( './worker.js', import.meta.url ), { workerData: { backend } } );
	await new Promise( ( resolve, reject ) => {

		const timer = setTimeout( () => {

			worker.terminate(); reject( new Error( 'Worker initialization timeout' ) );

		}, timeoutMs );
		worker.once( 'message', () => {

			clearTimeout( timer ); resolve();

		} );
		worker.once( 'error', error => {

			clearTimeout( timer ); reject( error );

		} );

	} );
	return worker;

}

function runCase( worker, fixture ) {

	return new Promise( resolve => {

		const finish = result => {

			clearTimeout( timer );
			worker.removeListener( 'message', finish );
			worker.removeListener( 'error', onError );
			resolve( result );

		};

		const onError = error => finish( { status: 'worker-error', error: error.message } );
		const timer = setTimeout( () => {

			worker.terminate();
			finish( { status: 'timeout', timeoutMs } );

		}, timeoutMs );
		worker.once( 'message', finish );
		worker.once( 'error', onError );
		worker.postMessage( fixture );

	} );

}

async function main() {

	const filter = process.argv.includes( '--case' ) ? process.argv[ process.argv.indexOf( '--case' ) + 1 ] : null;
	const fixtures = [ ...directCorpus(), ...csgCorpus() ].filter( f => ! filter || f.id === filter );
	if ( ! fixtures.length ) throw new Error( 'No matching fixture' );
	const resultName = filter ? 'replay.json' : 'results.json';
	for ( const fixture of fixtures ) {

		if ( fixture.kind === 'direct' ) {

			fixture.inputIssues = validateInput( fixture );
			if ( fixture.expectedValid !== ( fixture.inputIssues.length === 0 ) ) throw new Error( `Corpus validity mismatch: ${ fixture.id }: ${ fixture.inputIssues }` );

		}

	}

	const workers = new Map();
	for ( const backend of backends ) workers.set( backend, await startWorker( backend ) );
	const report = { date: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
		cpu: cpus()[ 0 ].model, versions: { delaunay32: '0.2.0', cdt2d: '1.0.0' }, timeoutMs,
		methodology: 'Sequential jobs; rotated backend order; reused workers/WASM; exact dyadic direct validation; 10 warmups and 21 timing batches of 64 direct calls or 1 CSG call. Timing excludes validation, initialization and CSG input preparation. cdt2d-domain keeps all faces inside these convex direct domains.', cases: [] };
	await mkdir( new URL( '../../docs/robustness/', import.meta.url ), { recursive: true } );
	try {

		for ( const [ index, fixture ] of fixtures.entries() ) {

			const entry = { fixture, results: {} };
			const activeBackends = fixture.kind === 'direct' ? backends : [ 'cdt2d', 'delaunay32' ];
			for ( let offset = 0; offset < activeBackends.length; offset ++ ) {

				const backend = activeBackends[ ( index + offset ) % activeBackends.length ];
				const result = await runCase( workers.get( backend ), fixture );
				entry.results[ backend ] = result;
				if ( result.status === 'timeout' || result.status === 'worker-error' ) {

					await workers.get( backend ).terminate();
					workers.set( backend, await startWorker( backend ) );

				}

			}

			report.cases.push( entry );
			if ( ( index + 1 ) % 20 === 0 || index === fixtures.length - 1 ) console.log( `${ index + 1 }/${ fixtures.length } fixtures complete` );
			await writeFile( new URL( `../../docs/robustness/${ resultName }`, import.meta.url ), JSON.stringify( { ...report, cases: undefined } ).slice( 0, - 1 ) + ',"cases":[\n' + report.cases.map( c => JSON.stringify( c ) ).join( ',\n' ) + '\n]}\n' );

		}

	} finally {

		for ( const worker of workers.values() ) await worker.terminate();

	}

	if ( ! filter ) await writeReport();

	const groups = {
		'direct-valid-integer': c => c.fixture.kind === 'direct' && c.fixture.expectedValid && c.fixture.encoding === 'integer',
		'direct-valid-float': c => c.fixture.kind === 'direct' && c.fixture.expectedValid && c.fixture.encoding === 'float',
		'direct-invalid': c => c.fixture.kind === 'direct' && ! c.fixture.expectedValid,
		'full-csg': c => c.fixture.kind === 'csg',
	};
	for ( const [ group, filter ] of Object.entries( groups ) ) {

		for ( const backend of backends ) {

			const counts = {};
			for ( const entry of report.cases.filter( filter ) ) {

				if ( ! entry.results[ backend ] ) continue;
				const status = entry.results[ backend ].status;
				counts[ status ] = ( counts[ status ] || 0 ) + 1;

			}

			console.log( JSON.stringify( { group, backend, counts } ) );

		}

	}

}

main().catch( error => {

	console.error( error ); process.exitCode = 1;

} );
