import { directCorpus } from '../benchmark/robustness/corpus.js';
import { exactPoints, validateInput, validateOutput } from '../benchmark/robustness/geometry.js';

const square = {
	points: [[ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ]],
	edges: [[ 0, 1 ], [ 1, 2 ], [ 2, 3 ], [ 3, 0 ]], boundary: [ 0, 1, 2, 3 ],
};

describe( 'independent robustness validation', () => {

	it( 'accepts either valid diagonal rather than requiring identical triangulations', () => {

		expect( validateOutput( square, [[ 0, 1, 2 ], [ 0, 2, 3 ]] ).issues ).toEqual( [] );
		expect( validateOutput( square, [[ 0, 1, 3 ], [ 1, 2, 3 ]] ).issues ).toEqual( [] );

	} );

	it( 'rejects equal-area duplicate and overlapping faces', () => {

		const duplicate = validateOutput( square, [[ 0, 1, 2 ], [ 0, 1, 2 ]] ).issues;
		expect( duplicate ).toContain( 'duplicate-face' );
		expect( duplicate ).not.toContain( 'area-mismatch' );
		const overlap = validateOutput( square, [[ 0, 1, 2 ], [ 1, 2, 3 ]] ).issues;
		expect( overlap ).toContain( 'crossing-output-edges' );
		expect( overlap ).not.toContain( 'area-mismatch' );

	} );

	it( 'detects missing constraints even if area and the outer boundary are correct', () => {

		const fixture = { ...square, edges: [ ...square.edges, [ 1, 3 ]] };
		expect( validateInput( fixture ) ).toEqual( [] );
		expect( validateOutput( fixture, [[ 0, 1, 2 ], [ 0, 2, 3 ]] ).issues ).toContain( 'missing-constraint' );

	} );

	it( 'detects missing regions, reversed faces and invalid indices', () => {

		expect( validateOutput( square, [[ 0, 1, 2 ]] ).issues ).toContain( 'area-mismatch' );
		expect( validateOutput( square, [[ 0, 2, 1 ], [ 0, 2, 3 ]] ).issues ).toContain( 'nonpositive-triangle-area' );
		expect( validateOutput( square, [[ 0, 1, 99 ]] ).issues ).toContain( 'invalid-triangle-index' );

	} );

	it( 'preserves exact near-coincident values at very different scales', () => {

		const p = exactPoints( [[ 0, 0 ], [ 1, 2 ** - 100 ], [ 1 + Number.EPSILON, 0 ]] );
		expect( p[ 1 ][ 1 ] > 0n ).toBe( true );
		expect( p[ 2 ][ 0 ] > p[ 1 ][ 0 ] ).toBe( true );
		const tiny = exactPoints( [[ 0, 0 ], [ Number.MIN_VALUE, 0 ], [ 0, Number.MIN_VALUE ]] );
		expect( tiny[ 1 ][ 0 ] ).toBe( 1n );

	} );

	it( 'classifies the generated corpus before testing any backend', () => {

		for ( const fixture of directCorpus() ) {

			expect( validateInput( fixture ).length === 0 ).toBe( fixture.expectedValid );

		}

	} );

} );
