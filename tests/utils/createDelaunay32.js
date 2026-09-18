import { readFile } from 'node:fs/promises';
import { createDelaunay32 } from 'delaunay32';

// The published WASM loader targets browsers. Supply a fetchable URL for Node
// tests without modifying global fetch or the package's implementation.
export async function createTestDelaunay32() {

	const bytes = await readFile( new URL( '../../node_modules/delaunay32/dist/delaunay32-module.wasm', import.meta.url ) );
	return createDelaunay32( { wasmUrl: `data:application/wasm;base64,${ bytes.toString( 'base64' ) }` } );

}
