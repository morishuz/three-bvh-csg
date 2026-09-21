// Exact signs for the actual IEEE-754 input coordinates. These checks are
// independent of both triangulators, and deliberately outside timed regions.
function dyadic( value ) {

	if ( ! Number.isFinite( value ) ) throw new Error( 'Non-finite coordinate' );
	const view = new DataView( new ArrayBuffer( 8 ) );
	view.setFloat64( 0, value );
	const bits = view.getBigUint64( 0 );
	const exponent = Number( ( bits >> 52n ) & 2047n );
	const fraction = bits & ( ( 1n << 52n ) - 1n );
	const magnitude = exponent ? fraction + ( 1n << 52n ) : fraction;
	return { n: bits >> 63n ? - magnitude : magnitude, e: exponent ? exponent - 1075 : - 1074 };

}

export function exactPoints( points ) {

	const parts = points.map( p => p.map( dyadic ) );
	const nonzero = parts.flat().filter( p => p.n !== 0n );
	const exponent = Math.min( ...nonzero.map( p => p.e ), 0 );
	return parts.map( p => p.map( v => v.n === 0n ? 0n : v.n << BigInt( v.e - exponent ) ) );

}

function orient( a, b, c ) {

	return ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - a[ 0 ] );

}

function opposite( a, b ) {

	return a < 0n && b > 0n || a > 0n && b < 0n;

}

function crossing( a, b, c, d ) {

	return opposite( orient( a, b, c ), orient( a, b, d ) ) && opposite( orient( c, d, a ), orient( c, d, b ) );

}

function insideSegment( a, b, p ) {

	return orient( a, b, p ) === 0n &&
		( p[ 0 ] - a[ 0 ] ) * ( p[ 0 ] - b[ 0 ] ) + ( p[ 1 ] - a[ 1 ] ) * ( p[ 1 ] - b[ 1 ] ) < 0n;

}

function key( a, b ) {

	return a < b ? `${ a },${ b }` : `${ b },${ a }`;

}

function area2( points, ring ) {

	let sum = 0n;
	for ( let i = 1; i < ring.length - 1; i ++ ) sum += orient( points[ ring[ 0 ] ], points[ ring[ i ] ], points[ ring[ i + 1 ] ] );
	return sum;

}

export function validateInput( fixture ) {

	const { points, edges, boundary } = fixture;
	const exact = exactPoints( points );
	const issues = [];
	const sites = new Set( exact.map( p => p.join( ',' ) ) );
	if ( sites.size !== points.length ) issues.push( 'duplicate-sites' );
	const area = area2( exact, boundary );
	if ( area <= 0n ) issues.push( 'nonpositive-domain-area' );
	const seen = new Set();
	for ( const [ a, b ] of edges ) {

		if ( ! exact[ a ] || ! exact[ b ] ) {

			issues.push( 'invalid-edge-index' ); continue;

		}

		if ( a === b ) issues.push( 'self-edge' );
		const edgeKey = key( a, b );
		if ( seen.has( edgeKey ) ) issues.push( 'duplicate-edge' );
		seen.add( edgeKey );
		for ( let v = 0; v < exact.length; v ++ ) {

			if ( insideSegment( exact[ a ], exact[ b ], exact[ v ] ) ) issues.push( 'unsplit-site-on-edge' );

		}

	}

	for ( let i = 0; i < edges.length; i ++ ) {

		for ( let j = i + 1; j < edges.length; j ++ ) {

			const [ a, b ] = edges[ i ];
			const [ c, d ] = edges[ j ];
			if ( crossing( exact[ a ], exact[ b ], exact[ c ], exact[ d ] ) ) issues.push( 'crossing-constraints' );

		}

	}

	// All domains in this corpus are convex, with optional collinear subdivisions.
	for ( let i = 0; i < boundary.length; i ++ ) {

		const a = exact[ boundary[ i ] ];
		const b = exact[ boundary[ ( i + 1 ) % boundary.length ] ];
		if ( ! seen.has( key( boundary[ i ], boundary[ ( i + 1 ) % boundary.length ] ) ) ) issues.push( 'missing-boundary-constraint' );
		for ( const p of exact ) if ( orient( a, b, p ) < 0n ) issues.push( 'site-outside-convex-domain' );

	}

	return [ ...new Set( issues ) ];

}

export function validateOutput( fixture, triangles ) {

	const p = exactPoints( fixture.points );
	const issues = new Set();
	const edgeUses = new Map();
	const faces = new Set();
	const usedSites = new Set();
	let totalArea = 0n;
	for ( const tri of triangles ) {

		if ( tri.length !== 3 || tri.some( i => ! Number.isInteger( i ) || i < 0 || i >= p.length ) ) {

			issues.add( 'invalid-triangle-index' );
			continue;

		}

		const area = orient( ...tri.map( i => p[ i ] ) );
		if ( area <= 0n ) issues.add( 'nonpositive-triangle-area' );
		totalArea += area;
		const face = [ ...tri ].sort( ( a, b ) => a - b ).join( ',' );
		if ( faces.has( face ) ) issues.add( 'duplicate-face' );
		faces.add( face );
		for ( let i = 0; i < 3; i ++ ) {

			const a = tri[ i ], b = tri[ ( i + 1 ) % 3 ];
			usedSites.add( a );
			const edgeKey = key( a, b );
			if ( ! edgeUses.has( edgeKey ) ) edgeUses.set( edgeKey, [] );
			edgeUses.get( edgeKey ).push( [ a, b ] );

		}

	}

	const boundaryEdges = new Set( fixture.boundary.map( ( a, i ) => key( a, fixture.boundary[ ( i + 1 ) % fixture.boundary.length ] ) ) );
	for ( const [ a, b ] of fixture.edges ) if ( ! edgeUses.has( key( a, b ) ) ) issues.add( 'missing-constraint' );
	if ( usedSites.size !== p.length ) issues.add( 'unused-site' );
	if ( totalArea !== area2( p, fixture.boundary ) ) issues.add( 'area-mismatch' );
	for ( const [ edgeKey, uses ] of edgeUses ) {

		if ( uses.length !== ( boundaryEdges.has( edgeKey ) ? 1 : 2 ) ) issues.add( 'edge-incidence' );
		if ( uses.length === 2 && uses[ 0 ][ 0 ] !== uses[ 1 ][ 1 ] ) issues.add( 'inconsistent-edge-winding' );

	}

	const edges = [ ...edgeUses.values() ].map( uses => uses[ 0 ] );
	for ( let i = 0; i < edges.length; i ++ ) {

		const [ a, b ] = edges[ i ];
		for ( const q of p ) if ( insideSegment( p[ a ], p[ b ], q ) ) issues.add( 'output-t-junction' );
		for ( let j = i + 1; j < edges.length; j ++ ) {

			const [ c, d ] = edges[ j ];
			if ( crossing( p[ a ], p[ b ], p[ c ], p[ d ] ) ) issues.add( 'crossing-output-edges' );

		}

	}

	// Detect a nested overlapping triangle even when no edges properly cross.
	for ( const tri of triangles ) {

		if ( tri.some( i => ! p[ i ] ) ) continue;
		for ( let v = 0; v < p.length; v ++ ) {

			if ( ! tri.includes( v ) && tri.every( ( a, i ) => orient( p[ a ], p[ tri[ ( i + 1 ) % 3 ] ], p[ v ] ) > 0n ) ) issues.add( 'site-inside-triangle' );

		}

	}

	return { issues: [ ...issues ], triangleCount: triangles.length };

}
