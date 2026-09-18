const scenarios = [ 'boxes', 'rotated-boxes', 'spheres', 'dense-spheres', 'near-coplanar' ];
const backends = [ 'legacy', 'cdt2d', 'delaunay32' ];
const button = document.querySelector( '#run' );
const output = document.querySelector( '#result' );
const body = document.querySelector( '#results' );
let results = [];

function runCase( scenario, backend ) {

	return new Promise( resolve => {

		const worker = new Worker( new URL( './delaunay32-worker.js', import.meta.url ), { type: 'module' } );
		const finish = result => {

			clearTimeout( timer );
			worker.terminate();
			resolve( result );

		};

		const timer = setTimeout( () => finish( { scenario, backend, error: 'Timed out after 20 seconds' } ), 20000 );
		worker.onmessage = event => finish( event.data );
		worker.onerror = event => finish( { scenario, backend, error: event.message } );
		worker.postMessage( { scenario, backend } );

	} );

}

function render() {

	body.replaceChildren();
	for ( const scenario of scenarios ) {

		const group = results.filter( r => r.scenario === scenario );
		const reference = group.find( r => r.backend === 'legacy' && ! r.error );
		const cdt = group.find( r => r.backend === 'cdt2d' && ! r.error );
		for ( const backend of backends ) {

			const result = group.find( r => r.backend === backend );
			if ( ! result ) continue;
			const tr = document.createElement( 'tr' );
			const check = result.error ? result.error : scenario === 'boxes' ?
				( Math.abs( result.volume - 4 ) < 1e-6 ? 'Expected volume ✓' : 'VOLUME MISMATCH' ) : reference ?
					( Math.abs( result.volume - reference.volume ) < 1e-5 ? 'Volume agrees with legacy' : 'VOLUME MISMATCH' ) : 'No reference';
			const values = [ scenario, backend, result.error ? '—' : result.medianMs.toFixed( 2 ),
				result.error ? '—' : result.p95Ms.toFixed( 2 ),
				! result.error && cdt ? `${ ( cdt.medianMs / result.medianMs ).toFixed( 2 ) }×` : '—',
				result.error ? '—' : result.volume.toFixed( 7 ), result.triangles ?? '—', check ];
			for ( const value of values ) {

				const td = document.createElement( 'td' );
				td.textContent = value;
				tr.append( td );

			}

			body.append( tr );

		}

	}

}

button.onclick = async () => {

	button.disabled = true;
	document.querySelector( '#download' ).disabled = true;
	results = [];
	render();
	try {

		for ( const [ index, scenario ] of scenarios.entries() ) {

			// Rotate execution order to reduce systematic first/last backend bias.
			for ( let offset = 0; offset < backends.length; offset ++ ) {

				const backend = backends[ ( index + offset ) % backends.length ];
				output.textContent = `Running ${ scenario } / ${ backend } (${ results.length + 1 }/15)…`;
				results.push( await runCase( scenario, backend ) );
				render();

			}

		}

		output.textContent = `Complete: ${ results.filter( r => ! r.error ).length }/15 cases completed. Download includes all timing samples and errors.`;
		document.querySelector( '#download' ).disabled = false;

	} finally {

		button.disabled = false;

	}

};

document.querySelector( '#download' ).onclick = () => {

	const blob = new Blob( [ JSON.stringify( {
		date: new Date().toISOString(), userAgent: navigator.userAgent,
		warmups: 10, iterations: 30, results,
	}, null, 2 ) ], { type: 'application/json' } );
	const url = URL.createObjectURL( blob );
	const link = document.createElement( 'a' );
	link.href = url;
	link.download = 'delaunay32-browser-benchmark.json';
	link.click();
	setTimeout( () => URL.revokeObjectURL( url ), 1000 );

};
