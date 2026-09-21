import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { BoxGeometry, SphereGeometry, Vector3 } from 'three';
import cdt2d from '../../src/libs/cdt2d.js';
import { Brush, Evaluator, CDTTriangleSplitter, SUBTRACTION, INTERSECTION, ADDITION } from '../../src/index.js';
import { Delaunay32TriangleSplitter } from '../../examples/utils/Delaunay32TriangleSplitter.mjs';
import { createTestDelaunay32 } from '../../tests/utils/createDelaunay32.js';
import { validateOutput } from './geometry.js';

const backend = workerData.backend;
const operations = { subtraction: SUBTRACTION, intersection: INTERSECTION, union: ADDITION };
let api;

function measure( run, direct ) {

	for ( let i = 0; i < 10; i ++ ) run();
	const batchSize = direct ? 64 : 1;
	const samples = [];
	for ( let sample = 0; sample < 21; sample ++ ) {

		const start = performance.now();
		for ( let i = 0; i < batchSize; i ++ ) run();
		samples.push( ( performance.now() - start ) / batchSize );

	}

	const sorted = [ ...samples ].sort( ( a, b ) => a - b );
	return { medianMs: sorted[ 10 ], p95Ms: sorted[ 19 ], batchSize, samples };

}

function runDirect( fixture ) {

	let quantization;
	const run = () => {

		if ( backend !== 'delaunay32' ) return cdt2d( fixture.points, fixture.edges, { exterior: backend === 'cdt2d-domain' } );
		const result = api.triangulate( {
			points: fixture.encoding === 'integer' ? new Int32Array( fixture.points.flat() ) : new Float64Array( fixture.points.flat() ),
			constraints: new Uint32Array( fixture.edges.flat() ),
			polygons: [ { outerRing: new Uint32Array( fixture.boundary ) } ],
			...fixture.encoding === 'float' ? { quantization: { collisionPolicy: 'reject' } } : {},
		} );
		quantization = result.quantizationReport;
		const triangles = [];
		for ( let i = 0; i < result.triangles.length; i += 3 ) triangles.push( Array.from( result.triangles.subarray( i, i + 3 ) ) );
		return triangles;

	};

	const triangles = run();
	const validation = validateOutput( fixture, triangles );
	const timing = fixture.performance && ! validation.issues.length ? measure( run, true ) : null;
	return { status: ! fixture.expectedValid ? 'returned-invalid-input' : validation.issues.length ? 'invalid-output' : 'checks-pass', validation, timing, quantization,
		...validation.issues.length ? { triangles } : {} };

}

function validateMesh( mesh, fixture ) {

	const geometry = mesh.geometry;
	const position = geometry.attributes.position;
	const index = geometry.index;
	const count = Math.min( geometry.drawRange.count, index ? index.count : position.count );
	const start = geometry.drawRange.start;
	const issues = [];
	const edges = new Map();
	let signedVolume = 0, degenerateTriangles = 0;
	const a = new Vector3(), b = new Vector3(), c = new Vector3(), cross = new Vector3();
	for ( let i = start; i < start + count; i += 3 ) {

		a.fromBufferAttribute( position, index ? index.getX( i ) : i );
		b.fromBufferAttribute( position, index ? index.getX( i + 1 ) : i + 1 );
		c.fromBufferAttribute( position, index ? index.getX( i + 2 ) : i + 2 );
		if ( [ ...a, ...b, ...c ].some( v => ! Number.isFinite( v ) ) ) issues.push( 'nonfinite-vertex' );
		signedVolume += a.dot( cross.crossVectors( b, c ) ) / 6;
		const keys = [ a, b, c ].map( p => p.toArray().join( ',' ) );
		for ( let e = 0; e < 3; e ++ ) {

			const x = keys[ e ], y = keys[ ( e + 1 ) % 3 ];
			const key = x < y ? `${ x };${ y }` : `${ y };${ x }`;
			edges.set( key, ( edges.get( key ) || 0 ) + 1 );

		}

		b.sub( a ); c.sub( a );
		if ( cross.crossVectors( b, c ).lengthSq() === 0 ) degenerateTriangles ++;

	}

	if ( degenerateTriangles ) issues.push( 'zero-area-face' );
	if ( ! Number.isFinite( signedVolume ) || signedVolume < - 1e-10 ) issues.push( 'invalid-signed-volume' );
	let expectedVolume = null;
	if ( fixture.family === 'analytic-boxes' ) {

		const base = fixture.size.reduce( ( a, b ) => a * b, 1 );
		const intersection = fixture.size.reduce( ( volume, size, i ) => volume * Math.max( 0, size - Math.abs( fixture.offset[ i ] ) ), 1 );
		expectedVolume = fixture.operation === 'subtraction' ? base - intersection : fixture.operation === 'intersection' ? intersection : 2 * base - intersection;
		if ( Math.abs( signedVolume - expectedVolume ) > base * 1e-6 ) issues.push( 'analytic-volume-mismatch' );

	}

	return { issues: [ ...new Set( issues ) ], signedVolume, expectedVolume, triangles: count / 3, degenerateTriangles,
		// Diagnostic only: exact endpoint matching can flag valid subdivided edges.
		unpairedExactEdges: [ ...edges.values() ].filter( n => n !== 2 ).length };

}

function runCSG( fixture ) {

	const makeGeometry = () => fixture.segments ? new SphereGeometry( 1, fixture.segments, fixture.segments / 2 ) : new BoxGeometry( ...fixture.size );
	const a = new Brush( makeGeometry() );
	const b = new Brush( makeGeometry() );
	b.position.fromArray( fixture.offset );
	if ( fixture.rotation ) b.rotation.set( ...fixture.rotation );
	b.updateMatrixWorld( true );
	a.prepareGeometry(); b.prepareGeometry();
	const evaluator = new Evaluator();
	const splitter = backend === 'delaunay32' ? new Delaunay32TriangleSplitter( api ) : new CDTTriangleSplitter();
	evaluator.triangleSplitter = splitter;
	let lastInput;
	let capture = true;
	const capturedInputs = [];
	const triangulate = splitter.triangulate2D.bind( splitter );
	splitter.triangulate2D = ( points, edges, boundary ) => {

		lastInput = { points, edges, boundary };
		if ( capture ) capturedInputs.push( lastInput );
		return triangulate( points, edges, boundary );

	};

	const targets = [ new Brush(), new Brush(), new Brush() ];
	const run = () => {

		let input = a;
		for ( let pass = 0; pass < ( fixture.repeat ? 3 : 1 ); pass ++ ) {

			if ( fixture.repeat ) {

				b.position.set( fixture.offset[ 0 ] - pass * 0.5, fixture.offset[ 1 ] + pass * 0.3, fixture.offset[ 2 ] );
				b.updateMatrixWorld( true );

			}

			input = evaluator.evaluate( input, b, operations[ fixture.operation ], targets[ pass ] );

		}

		return input;

	};

	try {

		const result = run();
		const validation = validateMesh( result, fixture );
		capture = false;
		const timing = fixture.performance && ! validation.issues.length ? measure( run, false ) : null;
		return { status: validation.issues.length ? 'invalid-output' : 'checks-pass', validation, timing,
			...validation.issues.length ? { capturedInputs } : {} };

	} catch ( error ) {

		return { status: 'rejected', error: { name: error.name, code: error.code, message: error.message }, lastInput };

	} finally {

		a.geometry.dispose(); b.geometry.dispose();
		for ( const target of targets ) target.geometry.dispose();

	}

}

async function main() {

	if ( backend === 'delaunay32' ) api = await createTestDelaunay32();
	parentPort.postMessage( { ready: true } );
	parentPort.on( 'message', fixture => {

		try {

			parentPort.postMessage( fixture.kind === 'direct' ? runDirect( fixture ) : runCSG( fixture ) );

		} catch ( error ) {

			parentPort.postMessage( { status: 'rejected', error: { name: error.name, code: error.code, message: error.message } } );

		}

	} );

}

main().catch( error => {

	throw error;

} );
