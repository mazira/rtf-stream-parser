import * as fs from 'fs';
import * as iconvLite from 'iconv-lite';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { DeEncapsulate, DeEncapsulateOptions } from '../src/de-encapsulate';
import Tokenize from '../src/tokenize';

const pipelineAsync = promisify(pipeline);

async function run(filepath?: string) {
    if (!filepath) {
        console.log('Usage: ts-node to-text <filepath>');
        return;
    }

    const tokenize = new Tokenize();

    const options: Partial<DeEncapsulateOptions> = {
        decode: (buf, enc) => {
            return iconvLite.decode(buf, enc);
        },
        encode: (str, enc) => {
            return iconvLite.encode(str, enc);
        },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        warn: () => { },
    };

    const deEncapsulate = new DeEncapsulate(options);

    console.time('process');
    const streamIn = fs.createReadStream(filepath);
    const streamOut = fs.createWriteStream(filepath + '.de-enc.txt');
    await pipelineAsync(streamIn, tokenize, deEncapsulate, streamOut);
    console.timeEnd('process');
}

run(...process.argv.slice(2));
