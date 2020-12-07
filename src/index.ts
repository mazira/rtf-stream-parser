import { DeEncapsulate, DeEncapsulateOptions } from './de-encapsulate';
import { streamFlow } from './stream-flow';
import { Token, Tokenize } from './tokenize';
import { isDef } from './utils';

export { Tokenize, DeEncapsulate };

interface Result {
    mode: 'text' | 'html';
    text: string | Buffer;
}

export function deEncapsulateSync(rtf: Buffer | string, options?: Partial<DeEncapsulateOptions>): Result {
    const onError = (err?: any) => {
        if (isDef(err)) {
            throw err;
        }
    };

    const stream1 = new Tokenize();
    const stream2 = new DeEncapsulate(options);

    // Hijack the push methods
    stream1.push = (token: Token) => {
        stream2._transform(token, '', onError);
        return true;
    };

    const chunks: (string | Buffer)[] = [];
    stream2.push = (piece: string | Buffer) => {
        chunks.push(piece);
        return true;
    };

    // Pump the data
    stream1._transform(rtf, undefined, onError);
    stream1._flush(onError);
    stream2._flush(onError);

    const result = !options || !options.outputMode || options.outputMode === 'string'
        ? (chunks as string[]).join('')
        : Buffer.concat(chunks as Buffer[]);

    return {
        mode: stream2.isHtml ? 'html' : 'text',
        text: result
    };
}

export async function deEncapsulateStream(streamIn: NodeJS.ReadableStream, options?: Partial<DeEncapsulateOptions>): Promise<Result> {
    const stream1 = new Tokenize();
    const stream2 = new DeEncapsulate(options);

    const chunks = await streamFlow<string | Buffer>(
        streamIn,
        stream1,
        stream2
    );

    const result = !options || !options.outputMode || options.outputMode === 'string'
        ? (chunks as string[]).join('')
        : Buffer.concat(chunks as Buffer[]);

    return {
        mode: stream2.isHtml ? 'html' : 'text',
        text: result
    };
}
