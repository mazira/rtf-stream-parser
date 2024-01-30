import { Transform } from 'stream';
import { recodeSymbolFontText } from './decode';
import { FontTable, FontTableEntry } from './features/handleFonts.types';
import { FeatureHandler } from './features/types';
import { ProcessTokensGlobalState, ProcessTokensGroupState, ProcessTokensOptions, StringDecoder, StringEncoder } from './ProcessTokens.types';
import { Token, TokenType } from './tokenize';
import { isStr } from './utils';

const defaultStringDecoder: StringDecoder = (buf, enc) => buf.toString(enc);
const defaultStringEncoder: StringEncoder = (str, enc) => Buffer.from(str, enc as BufferEncoding);

export const procTokensDefaultOptions: ProcessTokensOptions = {
    decode: defaultStringDecoder,
    encode: defaultStringEncoder,
    outputMode: 'string',
    replaceSymbolFontChars: false,
    warn: console.warn
};

const knownSymbolFontNames: Partial<{ [name: string]: true }> = {
    Wingdings: true,
    'Wingdings 2': true,
    'Wingdings 3': true,
    Webdings: true,
    Symbol: true,
};

function isKnownSymbolFont(thisFont?: FontTableEntry): boolean {
    return !!thisFont && (
        thisFont.fcharsetCpg === 42
        || thisFont.cpg === 42
        || knownSymbolFontNames[thisFont.fontName || ''] === true);
}

export abstract class ProcessTokens extends Transform implements ProcessTokensGlobalState {
    // These members are all public to allow the handler functions to access without TS complaining...
    public _options: ProcessTokensOptions;
    public readonly _featureHandlers: FeatureHandler<ProcessTokensGlobalState>[];

    // These members are all public to allow the handler functions to access without TS complaining...
    public readonly _rootState: ProcessTokensGroupState = { uc: 1, groupDepth: 0, destDepth: 0, destGroupDepth: 0 };
    public _state: ProcessTokensGroupState = this._rootState;

    public _cpg = 1252;
    public _count = 0;

    public _lastLastToken: Token | null | undefined = null;
    public _lastToken: Token | null | undefined = null;
    public _currToken: Token | null | undefined = null;

    public _done = false;
    public _ansicpg = false;
    public _deff: string;
    public _fonttbl: FontTable | undefined;

    // Represents how many tokens left to skip after \u
    public _skip = 0;

    constructor(options?: Partial<ProcessTokensOptions>) {
        super({ writableObjectMode: true, readableObjectMode: true });

        this._options = {
            ...procTokensDefaultOptions,
            ...options
        };

        this._pushOutput = this._pushOutput.bind(this);
    }

    get defaultCodepage(): number {
        return this._cpg;
    }

    _getOutputAsString(data: string | Buffer, font: FontTableEntry | undefined): [string, boolean] {
        let outStr: string;
        let areSymbolFontCodepoints = false;

        if (font && isKnownSymbolFont(font)) {
            const chunks: string[] = [];
            if (isStr(data)) {
                // Word treats 0xF000-0xF0FF the same as 0x0000-0x00FF for symbol fonts
                for (const c of data) {
                    const codepoint = c.codePointAt(0) as number;
                    if ((codepoint >= 0 && codepoint <= 0xFF) || (codepoint >= 0xF000 && codepoint <= 0xF0FF)) {
                        chunks.push(String.fromCodePoint(codepoint % 0xF000));
                    } else {
                        chunks.push(String.fromCodePoint(codepoint));
                    }
                }
            } else {
                chunks.push(data.toString('latin1'));
            }
            const str1 = chunks.join('');

            const fontname = font.fontName;
            if (fontname
                && (this._options.replaceSymbolFontChars === true
                    || (this._options.replaceSymbolFontChars && this._options.replaceSymbolFontChars[fontname]))
            ) {
                const str2 = recodeSymbolFontText(str1, fontname, 'keep');
                outStr = str2 || '';
            } else {
                // Emit the symbol font codepoints as-is
                outStr = str1;
                areSymbolFontCodepoints = true;
            }
        } else if (isStr(data)) {
            outStr = data;
        } else {
            // Codepage data... either font codepage or default codepage
            const cpg = font
                ? font.cpg || font.fcharsetCpg || this._cpg
                : this._cpg;


            if (cpg === 20127 || cpg === 65001) {
                outStr = data.toString('utf8');
            } else if (cpg === 1200) {
                throw new Error('Decoding 1200');
                outStr = data.toString('utf16le');
            } else if (cpg !== undefined) {
                outStr = this._options.decode(data, 'cp' + cpg);
            } else {
                console.log('HELP1!');
                throw new Error('text with no codepage');
            }
        }

        return [outStr, areSymbolFontCodepoints];
    }

    _pushOutputData(outStr: string, areSymbolFontCodepoints: boolean): void {
        if (this._options.outputMode === 'buffer-utf8') {
            this.push(Buffer.from(outStr, 'utf8'));
        } else if (this._options.outputMode === 'buffer-default-cpg' && this._options.encode) {
            if (this._cpg === 20127 || this._cpg === 65001) {
                this.push(Buffer.from(outStr, 'utf8'));
            } else if (this._cpg === 1200) {
                this.push(Buffer.from(outStr, 'utf16le'));
            } else if (areSymbolFontCodepoints) {
                // Just emit the symbol font codepoints as 8-bit values
                const bytes: number[] = [];
                for (const c of outStr) {
                    const codepoint = c.charCodeAt(0) as number;
                    if (codepoint > 0xFF) {
                        bytes.push(0x20);
                    } else {
                        bytes.push(codepoint);
                    }
                }
                this.push(Buffer.from(bytes));
            } else {
                try {
                    const buf = this._options.encode(outStr, 'cp' + this._cpg);
                    this.push(buf);
                } catch (err) {
                    this._options.warn('Unable to encode to cp' + this._cpg);
                }
            }
        } else {
            this.push(outStr);
        }
    }

    _getCurrentFont(): FontTableEntry | undefined {
        const state = this._state;
        // Get current font or default
        const f = state.font || this._deff || '';
        const finfo = this._fonttbl && this._fonttbl[f];
        return finfo;
    }

    // Outputs Unicode text if in the proper state
    _pushOutput(data: Buffer | string): void {
        // Handle font names
        for (const feature of this._featureHandlers) {
            if (feature.outputDataFilter) {
                const handled = feature.outputDataFilter(this, data);
                if (handled) {
                    return;
                }
            }
        }

        const font = this._getCurrentFont();

        const [outStr, areSymbolFontCodepoints] = this._getOutputAsString(data, font);
        this._pushOutputData(outStr, areSymbolFontCodepoints);
    }

    _handleToken(token: Token): void {
        try {
            // Do all token functions
            for (const feature of this._featureHandlers) {
                if (feature.allTokenHandler) {
                    const result = feature.allTokenHandler(this, token);
                    if (result) {
                        return;
                    }
                }
            }

            // Do token type functions
            for (const feature of this._featureHandlers) {
                if (feature.tokenHandlers) {
                    const tokenHandler = feature.tokenHandlers[token.type];
                    if (tokenHandler) {
                        const result = tokenHandler(this, token as any);
                        if (result) {
                            return;
                        }
                    }
                }
            }

            if (token.type === TokenType.CONTROL) {
                // Do control token functions
                for (const feature of this._featureHandlers) {
                    if (feature.controlHandlers && feature.controlHandlers[token.word]) {
                        const result = feature.controlHandlers[token.word](this, token);
                        if (result) {
                            return;
                        }
                    }
                }
            }
        } catch (err) {
            return err;
        }
    }

    _transform(token: Token, encoding: string | undefined, cb: (error?: any) => void): void {
        const error = this._handleToken(token);
        cb(error);
    }

    _flush(cb: (error?: any) => void): void {
        let error;

        try {
            for (const feature of this._featureHandlers) {
                if (feature.preStreamFlushHandler) {
                    feature.preStreamFlushHandler(this);
                }
            }
        } catch (err) {
            error = err;
        }

        cb(error);
    }
}
