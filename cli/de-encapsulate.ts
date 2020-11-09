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
            return iconvLite.decode(buf, enc)
        },
        encode: (str, enc) => {
            return iconvLite.encode(str, enc)
        },
        warn: str => console.log('WARNING: ' + str)
    };

    const stripText = new DeEncapsulate(options);

    stripText.on('data', chunk => {
        console.log(chunk);
    });

    const stream = fs.createReadStream(filepath);
    await pipelineAsync(stream, tokenize, stripText);
}

run(...process.argv.slice(2));
