import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { BoxGeometry, SphereGeometry } from 'three';
import { Brush, Evaluator, CDTTriangleSplitter, LegacyTriangleSplitter, SUBTRACTION, computeMeshVolume } from '../src/index.js';
import { Delaunay32TriangleSplitter } from '../examples/utils/Delaunay32TriangleSplitter.mjs';
import { createTestDelaunay32 } from '../tests/utils/createDelaunay32.js';

async function main() {

	// Isolate synchronous backends so degenerate cases cannot hang the whole run.
	if ( isMainThread ) {

		for ( const scenario of [ 'boxes', 'rotated-boxes', 'spheres' ] ) {

			for ( const backend of [ 'legacy', 'cdt2d', 'delaunay32' ] ) {

				const result = await new Promise( resolve => {

					const worker = new Worker( new URL( import.meta.url ), { workerData: { scenario, backend } } );
					const timer = setTimeout( () => {

						worker.terminate();
						resolve( { scenario, backend, error: '20 second timeout' } );

					}, 20000 );
					worker.once( 'message', result => {

						clearTimeout( timer );
						resolve( result );

					} );
					worker.once( 'error', error => {

						clearTimeout( timer );
						resolve( { scenario, backend, error: error.message } );

					} );

				} );
				console.log( JSON.stringify( result ) );

			}

		}

	} else {

		const { scenario, backend } = workerData;
		const api = backend === 'delaunay32' ? await createTestDelaunay32() : null;
		const splitter = backend === 'delaunay32' ? new Delaunay32TriangleSplitter( api ) :
			backend === 'cdt2d' ? new CDTTriangleSplitter() : new LegacyTriangleSplitter();
		const evaluator = new Evaluator();
		evaluator.triangleSplitter = splitter;
		const geometry = () => scenario === 'spheres' ? new SphereGeometry( 1, 24, 16 ) : new BoxGeometry( 2, 2, 2 );
		const a = new Brush( geometry() );
		const b = new Brush( geometry() );
		b.position.set( 0.7, 0.2, 0.1 );
		if ( scenario === 'rotated-boxes' ) b.rotation.set( 0.2, 0.3, 0.1 );
		b.updateMatrixWorld( true );
		a.prepareGeometry();
		b.prepareGeometry();
		const target = new Brush();
		let calls = 0;
		let totalPoints = 0;
		let maxPoints = 0;
		let triangulationMs = 0;
		let lastInput;
		if ( splitter.triangulate2D ) {

			const triangulate = splitter.triangulate2D.bind( splitter );
			splitter.triangulate2D = ( points, edges, boundary ) => {

				lastInput = { points, edges, boundary };
				calls ++;
				totalPoints += points.length;
				maxPoints = Math.max( maxPoints, points.length );
				const start = performance.now();
				try {

					return triangulate( points, edges, boundary );

				} finally {

					triangulationMs += performance.now() - start;

				}

			};

		}

		try {

			for ( let i = 0; i < 3; i ++ ) evaluator.evaluate( a, b, SUBTRACTION, target );
			calls = totalPoints = maxPoints = triangulationMs = 0;
			const times = [];
			for ( let i = 0; i < 10; i ++ ) {

				const start = performance.now();
				evaluator.evaluate( a, b, SUBTRACTION, target );
				times.push( performance.now() - start );

			}

			times.sort( ( a, b ) => a - b );
			parentPort.postMessage( {
				scenario, backend, medianMs: ( times[ 4 ] + times[ 5 ] ) / 2,
				volume: computeMeshVolume( target ),
				triangles: target.geometry.drawRange.count / 3,
				callsPerOperation: calls / 10, meanPoints: calls ? totalPoints / calls : null,
				maxPoints, triangulationMsPerOperation: triangulationMs / 10,
			} );

		} catch ( error ) {

			parentPort.postMessage( { scenario, backend, error: error.message, input: lastInput } );

		} finally {

			api?.dispose();
			a.geometry.dispose();
			b.geometry.dispose();
			target.geometry.dispose();

		}

	}

}

main().catch( error => {

	console.error( error );
	process.exitCode = 1;

} );
