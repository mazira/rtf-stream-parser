import { Tokenize, Token } from './tokenize';
import { DeEncapsulate, Options } from './de-encapsulate';
import { isDef } from './utils';
import { streamFlow } from './stream-flow';

export { Tokenize, DeEncapsulate };

export function deEncapsulateSync(rtf: Buffer | string, options?: Pick<Options, 'decode' | 'warn'>) {
    const onError = (err?: any) => {
        if (isDef(err)) {
            throw err;
        }
    };

    const stream1 = new Tokenize();
    const stream2 = new DeEncapsulate({
        ...options,
        mode: 'either',
        prefix: true
    });

    // Hijack the push methods
    stream1.push = (token: Token) => {
        stream2._transform(token, '', onError);
        return true;
    };

    const strs: string[] = [];
    stream2.push = (piece: string) => {
        strs.push(piece);
        return true;
    };

    // Pump the data
    stream1._transform(rtf, '', onError);
    stream1._flush(onError);
    stream2._flush(onError);

    const str = strs.join('');
    if (!str.startsWith('html:') && !str.startsWith('text:')) {
        throw new Error('Expected "html:" or "text:" prefix');
    }

    return {
        mode: str.startsWith('html:') ? 'html' : 'text',
        text: str.substr(5)
    };
}

export async function deEncapsulateStream(streamIn: NodeJS.ReadableStream, options?: Pick<Options, 'decode' | 'warn'>) {
    const strs = await streamFlow<string>(
        streamIn,
        new Tokenize(),
        new DeEncapsulate({
            ...options,
            mode: 'either',
            prefix: true
        })
    );

    const str = strs.join('');
    if (!str.startsWith('html:') && !str.startsWith('text:')) {
        throw new Error('Expected "html:" or "text:" prefix');
    }

    return {
        mode: str.startsWith('html:') ? 'html' : 'text',
        text: str.substr(5)
    };
}