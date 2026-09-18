import { CDTTriangleSplitter } from '../../src/core/CDTTriangleSplitter.js';

// Experimental adapter. The caller owns and disposes the initialized WASM API.
// Keep this outside the main entry point so WASM remains an opt-in dependency.
export class Delaunay32TriangleSplitter extends CDTTriangleSplitter {

	constructor( delaunay ) {

		super();
		this.delaunay = delaunay;

	}

	triangulate2D( points, edges, boundary ) {

		const result = this.delaunay.triangulate( {
			points: new Float64Array( points.flat() ),
			constraints: new Uint32Array( edges.flat() ),
			// Keep boundary subdivision sites: quantization can move a site off
			// its original straight edge. Internal cut edges are not holes.
			polygons: [ { outerRing: new Uint32Array( boundary ) } ],
			quantization: { collisionPolicy: 'reject' },
		} );

		const triangles = [];
		for ( let i = 0; i < result.triangles.length; i += 3 ) {

			const a = result.triangles[ i ];
			const b = result.triangles[ i + 1 ];
			const c = result.triangles[ i + 2 ];
			// Reject topology that becomes degenerate or reversed when mapped
			// back to the original floating-point coordinates.
			const area = ( points[ b ][ 0 ] - points[ a ][ 0 ] ) * ( points[ c ][ 1 ] - points[ a ][ 1 ] ) -
				( points[ b ][ 1 ] - points[ a ][ 1 ] ) * ( points[ c ][ 0 ] - points[ a ][ 0 ] );
			if ( area <= 0 ) {

				throw new Error( 'Delaunay32: invalid triangle in original coordinates.' );

			}

			triangles.push( [ a, b, c ] );

		}

		return triangles;

	}

}
