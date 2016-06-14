'use strict';

// NPM
const Promise = require('bluebird');

/**
 * Given an array of streams and optional input data,
 * this function pipes the streams together, and pulls
 * data out the end, buffering it. Returns a promise
 * of the final output chunks. If any stream throws,
 * the promise will be rejected with the error.
 */
module.exports.streamFlow = function process(streams, inputs) {
  return new Promise(function (resolve, _reject) {
    const reject = (err) => {
      // Unpipe streams together
      for (let i = 1; i < streams.length; i++) {
        streams[i-1].unpipe();
      }

      _reject(err);
    };

    // Pipe streams together
    for (let i = 1; i < streams.length; i++) {
      streams[i-1].pipe(streams[i]);
    }

    // Set up error handlers
    for (let i = 0; i < streams.length; i++) {
      streams[i].on('error', reject)
    }

    // Write any input
    if (inputs) {
      const sin = streams[0];
      for (let i = 0; i < inputs.length; i++) {
        sin.write(inputs[i]);
      }

      sin.end();
    }

    const sout = streams[streams.length-1];

    let output = [];

    sout.on('readable', () => {
      let pieces;
      while (pieces = sout.read())
        output = output.concat(pieces);
    });

    sout.on('end', () => resolve(output));
  });
};
