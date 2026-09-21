function random( seed ) {

	return () => {

		seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0;
		return seed / 4294967296;

	};

}

function triangle( id, family, points = [], edges = [] ) {

	return {
		id, family, kind: 'direct', encoding: 'integer', expectedValid: true,
		points: [[ 0, 0 ], [ 1024, 0 ], [ 0, 1024 ], ...points ],
		edges: [[ 0, 1 ], [ 1, 2 ], [ 2, 0 ], ...edges ], boundary: [ 0, 1, 2 ],
	};

}

export function directCorpus() {

	const cases = [];
	for ( const count of [ 6, 12, 32, 96 ] ) {

		for ( let seed = 1; seed <= 16; seed ++ ) {

			const rng = random( seed * 7919 + count );
			const points = [];
			const seen = new Set();
			while ( points.length < count - 3 ) {

				const x = 1 + Math.floor( rng() * 1022 );
				const y = 1 + Math.floor( rng() * ( 1023 - x ) );
				if ( x + y >= 1024 || seen.has( `${ x },${ y }` ) ) continue;
				seen.add( `${ x },${ y }` );
				points.push( [ x, y ] );

			}

			const fixture = triangle( `cloud-${ count }-${ seed }`, 'integer-cloud', points );
			fixture.seed = seed;
			fixture.performance = seed <= 4;
			cases.push( fixture );

		}

	}

	for ( const n of [ 2, 4, 8 ] ) {

		const points = [], edges = [], boundary = [];
		const index = ( x, y ) => y * ( n + 1 ) + x;
		for ( let y = 0; y <= n; y ++ ) {

			for ( let x = 0; x <= n; x ++ ) {

				points.push( [ x * 1024 / n, y * 1024 / n ] );
				if ( x < n ) edges.push( [ index( x, y ), index( x + 1, y ) ] );
				if ( y < n ) edges.push( [ index( x, y ), index( x, y + 1 ) ] );

			}

		}

		for ( let x = 0; x < n; x ++ ) boundary.push( index( x, 0 ) );
		for ( let y = 0; y < n; y ++ ) boundary.push( index( n, y ) );
		for ( let x = n; x > 0; x -- ) boundary.push( index( x, n ) );
		for ( let y = n; y > 0; y -- ) boundary.push( index( 0, y ) );
		cases.push( { id: `grid-${ n }`, family: 'integer-constraints', kind: 'direct', encoding: 'integer', expectedValid: true, points, edges, boundary, performance: true } );

	}

	cases.push( triangle( 'internal-loop', 'integer-constraints', [[ 128, 128 ], [ 384, 128 ], [ 128, 384 ]], [[ 3, 4 ], [ 4, 5 ], [ 5, 3 ]] ) );
	cases.push( triangle( 'interior-open-edge', 'integer-constraints', [[ 128, 128 ], [ 384, 128 ]], [[ 3, 4 ]] ) );
	for ( const exponent of [ 0, 8, 16, 24, 32, 40 ] ) {

		const fixture = triangle( `sliver-${ exponent }`, 'float-sliver', [[ 256, 256 ], [ 512, 128 ]], [[ 3, 4 ]] );
		fixture.encoding = 'float';
		fixture.points = fixture.points.map( ( [ x, y ] ) => [ x / 1024, y / 1024 * 2 ** - exponent ] );
		cases.push( fixture );

	}

	for ( const exponent of [ 8, 16, 24, 28, 30, 32, 40, 48 ] ) {

		const fixture = triangle( `close-pair-${ exponent }`, 'float-close-pair', [[ 256, 256 ], [ 256 + 1024 * 2 ** - exponent, 256 ]], [[ 3, 4 ]] );
		fixture.encoding = 'float';
		fixture.points = fixture.points.map( p => p.map( v => v / 1024 ) );
		cases.push( fixture );

	}

	for ( const scale of [ 2 ** - 30, 2 ** - 10, 1, 2 ** 10, 2 ** 30 ] ) {

		for ( const translation of [ 0, 2 ** 20, 2 ** 40 ] ) {

			const fixture = triangle( `scale-${ scale }-offset-${ translation }`, 'float-transform', [[ 128, 128 ], [ 384, 128 ], [ 128, 384 ]], [[ 3, 4 ], [ 4, 5 ], [ 5, 3 ]] );
			fixture.encoding = 'float';
			fixture.points = fixture.points.map( ( [ x, y ] ) => [ x * scale + translation, y * scale + translation ] );
			// Some transforms intentionally lose distinct sites in IEEE-754 itself.
			fixture.expectedValid = new Set( fixture.points.map( p => p.join( ',' ) ) ).size === fixture.points.length;
			cases.push( fixture );

		}

	}

	for ( let seed = 1; seed <= 16; seed ++ ) {

		const rng = random( seed );
		const fixture = triangle( `float-cloud-${ seed }`, 'float-cloud', Array.from( { length: 12 }, () => {

			const x = rng() * 500 + 1;
			return [ x, rng() * ( 1000 - x ) + 1 ];

		} ) );
		fixture.encoding = 'float';
		fixture.seed = seed;
		fixture.performance = seed <= 4;
		cases.push( fixture );

	}

	const invalid = [
		triangle( 'duplicate-sites', 'invalid', [[ 128, 128 ], [ 128, 128 ]] ),
		triangle( 'crossing-constraints', 'invalid', [[ 128, 128 ], [ 384, 384 ], [ 128, 384 ], [ 384, 128 ]], [[ 3, 4 ], [ 5, 6 ]] ),
		triangle( 't-junction', 'invalid', [[ 128, 128 ], [ 384, 128 ], [ 256, 128 ]], [[ 3, 4 ]] ),
		triangle( 'self-edge', 'invalid', [], [[ 0, 0 ]] ),
	];
	for ( const fixture of invalid ) fixture.expectedValid = false;
	return cases.concat( invalid );

}

export function csgCorpus() {

	const cases = [];
	for ( const operation of [ 'subtraction', 'intersection', 'union' ] ) {

		for ( const offset of [[ 1, 0, 0 ], [ 0, 0, 0 ], [ 2, 0, 0 ], [ 2 - 2 ** - 20, 0, 0 ], [ 0.7, 0.2, 0.1 ]] ) {

			cases.push( { kind: 'csg', id: `boxes-${ operation }-${ offset.join( ',' ) }`, family: 'analytic-boxes', operation, offset, size: [ 2, 2, 2 ], performance: operation === 'subtraction' && offset[ 0 ] === 0.7 } );

		}

	}

	for ( const thickness of [ 2 ** - 8, 2 ** - 16, 2 ** - 24 ] ) {

		cases.push( { kind: 'csg', id: `thin-${ thickness }`, family: 'analytic-boxes', operation: 'subtraction', offset: [ 0.7, 0.2, 0 ], size: [ 2, 2, thickness ] } );

	}

	for ( let seed = 1; seed <= 12; seed ++ ) {

		const rng = random( seed * 104729 );
		cases.push( { kind: 'csg', id: `rotated-${ seed }`, family: 'rotated-boxes', operation: 'subtraction', seed, offset: [ 0.7, 0.2, 0.1 ], size: [ 2, 2, 2 ], rotation: [ rng(), rng(), rng() ], performance: seed === 1 } );

	}

	for ( const angle of [ 2 ** - 8, 2 ** - 16, 2 ** - 24, 2 ** - 32 ] ) {

		cases.push( { kind: 'csg', id: `near-coplanar-${ angle }`, family: 'near-coplanar', operation: 'subtraction', offset: [ 1, angle, 0 ], size: [ 2, 2, 2 ], rotation: [ 0, 0, angle ] } );

	}

	for ( const segments of [ 16, 32 ] ) {

		cases.push( { kind: 'csg', id: `spheres-${ segments }`, family: 'spheres', operation: 'subtraction', offset: [ 0.7, 0.2, 0.1 ], segments, performance: true } );

	}

	cases.push( { kind: 'csg', id: 'repeated-subtractions', family: 'repeated', operation: 'subtraction', offset: [ 0.7, 0.2, 0.1 ], size: [ 2, 2, 2 ], rotation: [ 0.2, 0.3, 0.1 ], repeat: true } );
	return cases;

}
