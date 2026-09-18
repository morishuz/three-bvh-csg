import { BoxGeometry, SphereGeometry } from 'three';
import { createDelaunay32 } from 'delaunay32';
import wasmUrl from 'delaunay32/wasm?url';
import { Brush, Evaluator, CDTTriangleSplitter, LegacyTriangleSplitter, SUBTRACTION, computeMeshVolume } from '../src/index.js';
import { Delaunay32TriangleSplitter } from './utils/Delaunay32TriangleSplitter.mjs';

self.onmessage = async ( { data: { scenario, backend } } ) => {

	let api, a, b, target;
	try {

		api = backend === 'delaunay32' ? await createDelaunay32( { wasmUrl } ) : null;
		const evaluator = new Evaluator();
		evaluator.triangleSplitter = backend === 'delaunay32' ? new Delaunay32TriangleSplitter( api ) :
			backend === 'cdt2d' ? new CDTTriangleSplitter() : new LegacyTriangleSplitter();
		const geometry = () => scenario === 'dense-spheres' ? new SphereGeometry( 1, 48, 32 ) :
			scenario === 'spheres' ? new SphereGeometry( 1, 24, 16 ) : new BoxGeometry( 2, 2, 2 );
		a = new Brush( geometry() );
		b = new Brush( geometry() );
		if ( scenario === 'boxes' ) {

			b.position.x = 1;

		} else if ( scenario === 'near-coplanar' ) {

			b.position.set( 1, 1e-7, 0 );
			b.rotation.z = 1e-7;

		} else {

			b.position.set( 0.7, 0.2, 0.1 );
			if ( scenario === 'rotated-boxes' ) b.rotation.set( 0.2, 0.3, 0.1 );

		}

		b.updateMatrixWorld( true );
		a.prepareGeometry();
		b.prepareGeometry();
		target = new Brush();
		for ( let i = 0; i < 10; i ++ ) evaluator.evaluate( a, b, SUBTRACTION, target );
		const samples = [];
		for ( let i = 0; i < 30; i ++ ) {

			const start = performance.now();
			evaluator.evaluate( a, b, SUBTRACTION, target );
			samples.push( performance.now() - start );

		}

		const sorted = [ ...samples ].sort( ( a, b ) => a - b );
		const volume = computeMeshVolume( target );
		if ( ! Number.isFinite( volume ) ) throw new Error( 'Non-finite output volume' );
		self.postMessage( {
			scenario, backend, samples, medianMs: ( sorted[ 14 ] + sorted[ 15 ] ) / 2,
			p95Ms: sorted[ 28 ], volume, triangles: target.geometry.drawRange.count / 3,
		} );

	} catch ( error ) {

		self.postMessage( { scenario, backend, error: error.message } );

	} finally {

		api?.dispose();
		a?.geometry.dispose();
		b?.geometry.dispose();
		target?.geometry.dispose();

	}

};
