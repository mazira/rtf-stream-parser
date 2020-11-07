import { Transform } from 'stream';
import { recodeSymbolFontText } from './decode';
import { TokenCountGlobalState } from './features/countTokens.types';
import { CharacterSetGlobalState } from './features/handleCharacterSet.types';
import { ControlAndDestinationGlobalState, ControlAndDestinationGroupState } from './features/handleControlsAndDestinations.types';
import { FontGlobalState, FontGroupState, FontTable, FontTableEntry } from './features/handleFonts.types';
import { GlobalStateWithGroupState, GroupGlobalState, GroupState } from './features/handleGroupState.types';
import { UnicodeGlobalState, UnicodeGroupState } from './features/handleUnicode.types';
import { FeatureHandler } from './features/types';
import { Token, TokenType } from './tokenize';
import { isDef, isStr } from './utils';

export type StringDecoder = (buf: Buffer, enc: string) => string;
export type StringEncoder = (str: string, enc: string) => Buffer;
export type LowLevelDecoder = (buf: Buffer, codepage: number, fontInfo: Readonly<FontTableEntry> | undefined, decoder: StringDecoder) => string | undefined;

export interface ProcessTokensOptions {
    decode: StringDecoder;
    encode: StringEncoder;
    outputMode: 'string' | 'buffer-utf8' | 'buffer-default-cpg';
    replaceSymbolFontChars: boolean | {
        [font: string]: boolean
    };
    warn: (msg: string) => void;
}

export interface ProcessTokensGroupState extends GroupState, UnicodeGroupState, ControlAndDestinationGroupState, FontGroupState { }

export interface ProcessTokensGlobalState extends
    TokenCountGlobalState,
    GroupGlobalState,
    UnicodeGlobalState,
    ControlAndDestinationGlobalState,
    CharacterSetGlobalState,
    FontGlobalState,
    GlobalStateWithGroupState<ProcessTokensGroupState> {
    _state: ProcessTokensGroupState;
    _rootState: ProcessTokensGroupState;
}

const defaultStringDecoder: StringDecoder = (buf, enc) => buf.toString(enc);
const defaultStringEncoder: StringEncoder = (str, enc) => Buffer.from(str, enc as BufferEncoding);

export const procTokensDefaultOptions: ProcessTokensOptions = {
    decode: defaultStringDecoder,
    encode: defaultStringEncoder,
    outputMode: 'string',
    replaceSymbolFontChars: false,
    warn: console.warn
}

const knownSymbolFontNames: { [name: string]: true } = {
    'Wingdings': true,
    'Wingdings 2': true,
    'Wingdings 3': true,
    'Webdings': true,
    'Symbol': true,
}

const enum TextType {
    Unicode,
    Codepage,
    Font,
    Symbol
}

interface BufferedBase {
    type: TextType;
    data: Buffer[] | string[] | (Buffer | string)[];
    font?: Readonly<FontTableEntry>;
    codepage?: number;
}

interface BufferedUnicodeText extends BufferedBase {
    type: TextType.Unicode;
    data: string[];
}

interface BufferedCodepageText extends BufferedBase {
    type: TextType.Codepage;
    data: Buffer[];
    codepage: number;
}

interface BufferedFontText extends BufferedBase {
    type: TextType.Font;
    data: Buffer[];
    font: Readonly<FontTableEntry>;
}

interface BufferedSymbolText extends BufferedBase {
    type: TextType.Symbol;
    data: (Buffer | string)[];
    font: Readonly<FontTableEntry>;
}

type BufferedOutput = BufferedUnicodeText | BufferedCodepageText | BufferedFontText | BufferedSymbolText;

export abstract class ProcessTokens extends Transform implements ProcessTokensGlobalState {
    // These members are all public to allow the handler functions to access without TS complaining...
    public _options: ProcessTokensOptions;
    public readonly _featureHandlers: FeatureHandler<CharacterSetGlobalState & FontGlobalState>[];

    // These members are all public to allow the handler functions to access without TS complaining...
    public readonly _rootState: ProcessTokensGroupState = { uc: 1, groupDepth: 0, destDepth: 0 };
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

    // Some text encodings can't be decoded byte by byte, so we buffer sequential text outputs
    public _bufferedOutput: BufferedOutput | undefined;

    constructor(options?: Partial<ProcessTokensOptions>) {
        super({ writableObjectMode: true, readableObjectMode: true });

        this._options = {
            ...procTokensDefaultOptions,
            ...options
        };
    }

    _getBufferedOutputText(): false | [string, boolean] {
        const bufd = this._bufferedOutput;
        if (!bufd) {
            return false;
        }

        let out: string;
        let areSymbolFontCodepoints = false;

        switch (bufd.type) {
            case TextType.Unicode: {
                out = bufd.data.join('');
                break;
            }
            case TextType.Symbol: {
                const chunks: string[] = [];
                for (const chunk of bufd.data) {
                    if (isStr(chunk)) {
                        // Word treats 0xF000-0xF0FF the same as 0x0000-0x00FF for symbol fonts
                        for (const c of chunk) {
                            let codepoint = c.codePointAt(0) as number;
                            if ((codepoint >= 0 && codepoint <= 0xFF) || (codepoint >= 0xF000 && codepoint <= 0xF0FF)) {
                                chunks.push(String.fromCodePoint(codepoint % 0xF000));
                            } else {
                                chunks.push(String.fromCodePoint(codepoint));
                            }
                        }
                    } else {
                        chunks.push(chunk.toString('latin1'));
                    }
                }
                const str1 = chunks.join('');

                const fontname = bufd.font.fontName;
                if (fontname
                    && (this._options.replaceSymbolFontChars === true
                        || (this._options.replaceSymbolFontChars && this._options.replaceSymbolFontChars[fontname]))
                ) {
                    const str2 = recodeSymbolFontText(str1, fontname, 'keep');
                    out = str2 || '';
                } else {
                    // Emit the symbol font codepoints as-is
                    out = str1;
                    areSymbolFontCodepoints = true;
                }
                break;
            }
            case TextType.Codepage:
            case TextType.Font: {
                const cpg = bufd.type === TextType.Codepage
                    ? bufd.codepage
                    : bufd.font.cpg || bufd.font.fcharsetCpg || this._cpg;

                const buf = Buffer.concat(bufd.data);

                if (cpg === 20127 || cpg === 65001) {
                    out = buf.toString('utf8');
                } else if (cpg === 1200) {
                    throw new Error('Decoding 1200');
                    out = buf.toString('utf16le');
                } else if (cpg) {
                    out = this._options.decode(buf, 'cp' + cpg);
                } else {
                    console.log('HELP1!');
                    throw new Error('text with no codepage');
                }
                break;
            }
            default: {
                throw new Error('Unhandled type of buffered data');
            }
        }

        return [out, areSymbolFontCodepoints];
    }

    _flushBuffer() {
        const outResult = this._getBufferedOutputText();
        if (!outResult) {
            return;
        }

        const [out, areSymbolFontCodepoints] = outResult;

        if (this._options.outputMode === 'buffer-utf8') {
            this.push(Buffer.from(out, 'utf8'));
        } else if (this._options.outputMode === 'buffer-default-cpg' && this._options.encode) {
            if (this._cpg === 20127 || this._cpg === 65001) {
                this.push(Buffer.from(out, 'utf8'));
            } else if (this._cpg === 1200) {
                this.push(Buffer.from(out, 'utf16le'));
            } else if (areSymbolFontCodepoints) {
                // Just emit the symbol font codepoints as 8-bit values
                const bytes: number[] = [];
                for (const c of out) {
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
                    const buf = this._options.encode(out, 'cp' + this._cpg);
                    this.push(buf);
                } catch (err) {
                    this._options.warn('Unable to encode to cp' + this._cpg)
                }
            }
        } else {
            this.push(out);
        }
    }

    _getCurrentFont(): FontTableEntry | undefined {
        const state = this._state;
        // Get current font or default
        const f = state.font || this._deff || '';
        const finfo = this._fonttbl && this._fonttbl[f];
        return finfo;
    }

    _getOutputChunk(data: Buffer | string): BufferedOutput {
        const thisFont = this._getCurrentFont();

        // Symbol fonts need to be treated as font codepoints regardless of if given with Unicode or not
        if (thisFont && (
            thisFont.fcharsetCpg === 42
            || thisFont.cpg === 42
            || (thisFont.fontName && knownSymbolFontNames[thisFont.fontName]))
        ) {
            return {
                type: TextType.Symbol,
                font: thisFont,
                data: [data],
            };
        } else if (isStr(data)) {
            return {
                type: TextType.Unicode,
                data: [data],
            };
        } else if (thisFont) {
            return {
                type: TextType.Font,
                font: thisFont,
                data: [data]
            };
        } else {
            return {
                type: TextType.Codepage,
                codepage: this._cpg,
                data: [data]
            };
        }
    }

    _canAddToBuffer(newChunk: BufferedOutput): boolean {
        const bufd = this._bufferedOutput;

        if (!bufd) {
            return false;
        }

        switch (bufd.type) {
            case TextType.Symbol:
                return newChunk.type === TextType.Symbol && bufd.font === newChunk.font;
            case TextType.Unicode:
                return newChunk.type === TextType.Unicode;
            case TextType.Font:
                return newChunk.type === TextType.Font && bufd.font === newChunk.font;
            case TextType.Codepage:
                return newChunk.type === TextType.Codepage && bufd.codepage === newChunk.codepage;
            default:
                return false;
        }
    }

    // Outputs Unicode text if in the proper state
    _doText(data: Buffer | string) {
        // Handle font names
        for (const feature of this._featureHandlers) {
            if (feature.outputDataFilter) {
                const handled = feature.outputDataFilter(this, data);
                if (handled) {
                    return;
                }
            }
        }

        const newChunk = this._getOutputChunk(data);
        if (this._canAddToBuffer(newChunk)) {
            this._bufferedOutput!.data.push(newChunk.data[0] as any);
        } else {
            if (this._bufferedOutput) {
                this._flushBuffer();
            }

            this._bufferedOutput = newChunk;
        }
    }

    _handleToken(token: Token) {
        try {
            // Do all token functions
            for (const feature of this._featureHandlers) {
                if (feature.allTokenHandler) {
                    const result = feature.allTokenHandler(this, token);
                    if (isDef(result)) {
                        if (result !== true) {
                            this._doText(result);
                        }
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
                        if (isDef(result)) {
                            if (result !== true) {
                                this._doText(result);
                            }
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
                        if (isDef(result)) {
                            if (result !== true) {
                                this._doText(result);
                            }
                            return;
                        }
                    }
                }
            }
        } catch (err) {
            return err;
        }
    }

    _transform(token: Token, encoding: string | undefined, cb: (error?: any) => void) {
        const error = this._handleToken(token);
        cb(error);
    }

    _flush(cb: (error?: any) => void) {
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

        this._flushBuffer();

        cb(error);
    }
}