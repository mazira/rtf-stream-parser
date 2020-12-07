import * as fs from 'fs';
import * as iconvLite from 'iconv-lite';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { ProcessTokensOptions } from '../src/ProcessTokens.types';
import Tokenize from '../src/tokenize';
import { ToPlainText } from '../src/ToPlainText';

const pipelineAsync = promisify(pipeline);

async function run(filepath?: string) {
    if (!filepath) {
        console.log('Usage: ts-node to-text <filepath>');
        return;
    }

    const s1 = fs.createReadStream(filepath);
    const s2 = new Tokenize();

    const options: Partial<ProcessTokensOptions> = {
        decode: (buf, enc) => {
            return iconvLite.decode(buf, enc);
        },
        encode: (str, enc) => {
            return iconvLite.encode(str, enc);
        },
        warn: str => console.log('WARNING: ' + str)
    };

    const s3 = new ToPlainText(options);
    const s4 = fs.createWriteStream(filepath + '.txt');

    await pipelineAsync(s1, s2, s3, s4);
}

run(...process.argv.slice(2));
