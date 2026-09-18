import { BoxGeometry } from 'three';
import { createDelaunay32 } from 'delaunay32';
import wasmUrl from 'delaunay32/wasm?url';
import { Brush, Evaluator, SUBTRACTION, computeMeshVolume } from '../src/index.js';
import { Delaunay32TriangleSplitter } from './utils/Delaunay32TriangleSplitter.mjs';

async function init() {

	const api = await createDelaunay32( { wasmUrl } );
	const evaluator = new Evaluator();
	evaluator.triangleSplitter = new Delaunay32TriangleSplitter( api );
	const button = document.querySelector( '#run' );
	const output = document.querySelector( '#result' );
	button.disabled = false;
	button.onclick = () => {

		const a = new Brush( new BoxGeometry( 2, 2, 2 ) );
		const b = new Brush( new BoxGeometry( 2, 2, 2 ) );
		b.position.x = 1;
		b.updateMatrixWorld( true );
		let result;
		try {

			const start = performance.now();
			result = evaluator.evaluate( a, b, SUBTRACTION );
			const milliseconds = performance.now() - start;
			const volume = computeMeshVolume( result );
			output.textContent = JSON.stringify( { volume, milliseconds, passed: Math.abs( volume - 4 ) < 1e-6 }, null, 2 );

		} catch ( error ) {

			output.textContent = error.stack;

		} finally {

			a.geometry.dispose();
			b.geometry.dispose();
			result?.geometry.dispose();

		}

	};

	window.addEventListener( 'pagehide', () => api.dispose(), { once: true } );
	button.click();

}

init().catch( error => {

	document.querySelector( '#result' ).textContent = error.stack;

} );
