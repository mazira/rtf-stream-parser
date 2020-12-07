export async function streamFlow<T>(stream1: NodeJS.ReadableStream, ...streams: NodeJS.ReadWriteStream[]): Promise<T[]> {
    return new Promise<T[]>((resolve, _reject) => {
        const reject = (err: Error) => {
            // Unpipe streams together
            stream1.unpipe();

            for (let i = 1; i < streams.length; i++) {
                streams[i - 1].unpipe();
            }

            _reject(err);
        };

        // Pipe streams together
        if (streams.length) {
            stream1.pipe(streams[0]);
        }
        for (let i = 1; i < streams.length; i++) {
            streams[i - 1].pipe(streams[i]);
        }

        // Set up error handlers
        stream1.on('error', reject);
        for (let i = 0; i < streams.length; i++) {
            streams[i].on('error', reject);
        }

        // Write any input
        /*
        if (inputs) {
            const sin = streams[0];
            for (let i = 0; i < inputs.length; i++) {
                sin.write(inputs[i]);
            }

            sin.end();
        }
        */

        const sout = streams.length ? streams[streams.length - 1] : stream1;

        const output: T[] = [];

        sout.on('readable', () => {
            while (true) {
                const piece: T = sout.read() as any;
                if (piece === null) {
                    break;
                }

                output.push(piece);
            }
        });

        sout.on('end', () => resolve(output));
    });
}
