import { BoxGeometry, Line3, Triangle, Vector3 } from 'three';
import { Brush, Evaluator, ADDITION, INTERSECTION, SUBTRACTION, computeMeshVolume } from '../src/index.js';
import { Delaunay32TriangleSplitter } from '../examples/utils/Delaunay32TriangleSplitter.mjs';
import { createTestDelaunay32 } from './utils/createDelaunay32.js';

let api;
beforeAll( async () => {

	api = await createTestDelaunay32();

} );
afterAll( () => api?.dispose() );

function split( segments, scale = 1 ) {

	const splitter = new Delaunay32TriangleSplitter( api );
	const v = ( x, y ) => new Vector3( x * scale, y * scale, 0 );
	splitter.initialize( new Triangle( v( 0, 0 ), v( 4, 0 ), v( 0, 4 ) ), 0, 1, 2 );
	for ( const [ x0, y0, x1, y1 ] of segments ) {

		splitter.addConstraintEdge( new Line3( v( x0, y0 ), v( x1, y1 ) ) );

	}

	splitter.triangulate();
	return splitter;

}

describe( 'experimental Delaunay32 splitter', () => {

	it.each( [
		[ 'uncut', []],
		[ 'boundary chord', [[ 0, 2, 2, 0 ]]],
		[ 'crossing cuts', [[ 0, 2, 2, 0 ], [ 0, 0, 2, 2 ]]],
		[ 'duplicate cuts', [[ 0, 2, 2, 0 ], [ 2, 0, 0, 2 ]]],
		[ 'closed internal loop', [[ 1, 1, 2, 1 ], [ 2, 1, 1, 2 ], [ 1, 2, 1, 1 ]]],
	] )( 'preserves face area for %s', ( name, segments ) => {

		const splitter = split( segments );
		expect( splitter.triangles.reduce( ( sum, t ) => sum + t.getArea(), 0 ) ).toBeCloseTo( 8, 12 );
		for ( const triangle of splitter.triangles ) {

			expect( triangle.getNormal( new Vector3() ).z ).toBe( 1 );
			for ( const p of [ triangle.a, triangle.b, triangle.c ] ) {

				expect( p.x ).toBeGreaterThanOrEqual( 0 );
				expect( p.y ).toBeGreaterThanOrEqual( 0 );
				expect( p.x + p.y ).toBeLessThanOrEqual( 4 );

			}

		}

	} );

	it( 'rejects quantization collisions instead of silently merging cuts', () => {

		const splitter = new Delaunay32TriangleSplitter( api );
		expect( () => splitter.triangulate2D(
			[[ 0, 0 ], [ 4, 0 ], [ 0, 4 ], [ 1, 1 ], [ 1 + 1e-12, 1 ]],
			[[ 0, 1 ], [ 1, 2 ], [ 2, 0 ], [ 3, 4 ]],
			[ 0, 1, 2 ]
		) ).toThrow();

	} );

	it( 'keeps a cut edge disconnected in the classification graph', () => {

		const splitter = split( [[ 0, 2, 2, 0 ]] );
		const seen = new Set();
		const pending = [ 0 ];
		while ( pending.length ) {

			const index = pending.pop();
			if ( seen.has( index ) ) continue;
			seen.add( index );
			pending.push( ...splitter.triangleConnectivity[ index ] );

		}

		expect( seen.size ).toBeLessThan( splitter.triangles.length );
		const area = [ ...seen ].reduce( ( sum, index ) => sum + splitter.triangles[ index ].getArea(), 0 );
		expect( [ 2, 6 ] ).toContain( area );

	} );

	it.each( [ 1e-4, 1, 1e4 ] )( 'handles scale %s', scale => {

		const splitter = split( [[ 0, 2, 2, 0 ]], scale );
		const area = splitter.triangles.reduce( ( sum, t ) => sum + t.getArea(), 0 );
		expect( area / ( scale * scale ) ).toBeCloseTo( 8, 10 );

	} );

	it.each( [[ ADDITION, 12 ], [ INTERSECTION, 4 ], [ SUBTRACTION, 4 ]] )(
		'produces the expected overlapping-box volume for operation %s', ( operation, volume ) => {

			const a = new Brush( new BoxGeometry( 2, 2, 2 ) );
			const b = new Brush( new BoxGeometry( 2, 2, 2 ) );
			b.position.x = 1;
			b.updateMatrixWorld( true );
			const evaluator = new Evaluator();
			evaluator.triangleSplitter = new Delaunay32TriangleSplitter( api );
			const result = evaluator.evaluate( a, b, operation );
			expect( computeMeshVolume( result ) ).toBeCloseTo( volume, 6 );
			result.geometry.dispose();
			a.geometry.dispose();
			b.geometry.dispose();

		}
	);

} );
