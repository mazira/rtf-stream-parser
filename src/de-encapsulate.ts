import { Transform } from 'stream';
import { recodeSymbolFontText } from './decode';
import { ControlToken, GroupEndToken, GroupStartToken, TextToken, Token, TokenType } from './tokenize';
import { isNum, isStr } from './utils';
import { words, WordType } from './words';

export type Mode = 'text' | 'html' | 'either';

export interface FontTableEntry {
    cpg?: number;
    fcharsetCpg?: number;
    themefont?: string;
    fontfamily?: string;
    fontname?: string;
}

export interface FontTable {
    [font: string]: FontTableEntry | undefined;
}

export type StringDecoder = (buf: Buffer, enc: string) => string;
export type StringEncoder = (str: string, enc: string) => Buffer;
export type LowLevelDecoder = (buf: Buffer, codepage: number, fontInfo: Readonly<FontTableEntry> | undefined, decoder: StringDecoder) => string | undefined;


export interface State {
    uc: number;
    destination?: string;
    ancDestIgnorable?: boolean;
    destIgnorable?: boolean;
    htmlrtf?: boolean;
    font?: string;
}


export interface NeededOptions {
    decode: StringDecoder;
    encode: StringEncoder;
    outputMode: 'string' | 'buffer-utf8' | 'buffer-default-cpg';
    replaceSymbolFontChars: boolean | {
        [font: string]: boolean
    };
    // Probaly one of  'Apple Color Emoji', 'Segoe UI Emoji','Segoe UI Symbol', 'Android Emoji', 'Noto Color Emoji', 'Emoji One', 'Twemoji' 
    htmlEncodeNonAscii: boolean;
    htmlFixContentType: boolean;
    mode: Mode;
    prefix: boolean;
    warn: (msg: string) => void;
}

const defaultStringDecoder: StringDecoder = (buf, enc) => buf.toString(enc);
const defaultStringEncoder: StringEncoder = (str, enc) => Buffer.from(str, enc as BufferEncoding);

const defaultOptions: NeededOptions = {
    decode: defaultStringDecoder,
    encode: defaultStringEncoder,
    outputMode: 'string',
    replaceSymbolFontChars: false,
    htmlEncodeNonAscii: false,
    // Probaly one of  'Apple Color Emoji', 'Segoe UI Emoji','Segoe UI Symbol', 'Android Emoji', 'Noto Color Emoji', 'Emoji One', 'Twemoji' 
    htmlFixContentType: false,
    mode: 'either',
    prefix: false,
    warn: console.warn
}

export type Options = Partial<NeededOptions>;

/*
const handledFonts: { [font: string]: boolean } = {
    'Wingdings': true,
    'Wingdings 2': true,
    'Wingdings 3': true,
    'Webdings': true,
    'Symbol': true
};
*/


const escapes: { [word: string]: string } = {
    'par': '\r\n',
    'line': '\r\n',
    'tab': '\t',
    '{': '{',
    '}': '}',
    '\\': '\\',
    'lquote': '\u2018',
    'rquote': '\u2019',
    'ldblquote': '\u201C',
    'rdblquote': '\u201D',
    'bullet': '\u2022',
    'endash': '\u2013',
    'emdash': '\u2014',
    '~': '\u00A0',
    '_': '\u00AD'
};

const charsetToCpg: { [charset: number]: number } = {
    0: 1252,
    2: 42,
    77: 10000,
    78: 10001,
    79: 10003,
    80: 10008,
    81: 10002,
    83: 10005,
    84: 10004,
    85: 10006,
    86: 10081,
    87: 10021,
    88: 10029,
    89: 10007,
    128: 932,
    129: 949,
    130: 1361,
    134: 936,
    136: 950,
    161: 1253,
    162: 1254,
    163: 1258,
    177: 1255,
    178: 1256,
    186: 1257,
    204: 1251,
    222: 874,
    238: 1250,
    254: 437,
    255: 850,

    // Found in the wild
    20127: 20127,
};

const knownSymbolFontNames: { [name: string]: true } = {
    'Wingdings': true,
    'Wingdings 2': true,
    'Wingdings 3': true,
    'Webdings': true,
    'Symbol': true,
}

function htmlEntityEncode(str: string) {
    const pieces: string[] = [];
    let ascii = true;
    for (const char of str) {
        const codepoint = char.codePointAt(0) as number;
        if (codepoint > 0x7F) {
            ascii = false;
            pieces.push('&#x' + codepoint.toString(16) + ';');
        } else {
            pieces.push(char);
        }
    }

    const out = ascii ? str : pieces.join('');
    return out;
}
/*
function htmlEntityEncode(str: string) {
    const pieces: string[] = [];
    let ascii = true;

    const len = str.length;
    let i = 0;
    for (; i < len; i++) {
        const codepoint = str.charCodeAt(i);
        if (codepoint > 0x7F) {
            ascii = false;
            pieces.push('&#' + codepoint + ';');
        } else {
            pieces.push(str[i]);
        }
    }

    const out = ascii ? str : pieces.join('');
    return out;
}
*/

type Handler = (this: DeEncapsulate, token: Token, count: number) => void;

const handleThemefont: Handler = function (token: ControlToken) {
    if (this._state.destination !== 'fonttbl' || !this._fonttbl) {
        throw new Error(token + ' not in fonttbl');
    }

    const f = this._state.font;
    const fontEntry = f && this._fonttbl[f];
    if (!f || !fontEntry) {
        throw new Error(token + ' with no current font');
    }

    fontEntry.themefont = token.word.slice(1);
};

const handleFontfamily: Handler = function (token: ControlToken) {
    if (this._state.destination !== 'fonttbl' || !this._fonttbl) {
        throw new Error(token + ' not in fonttbl');
    }

    const f = this._state.font;
    const fontEntry = f && this._fonttbl[f];
    if (!f || !fontEntry) {
        throw new Error(token + ' with no current font');
    }

    fontEntry.fontfamily = token.word.slice(1);
};

const handlers: { [key: string]: Handler } = {
    ///////////////////////////////////////////////////////////////////////////
    // Handlers for specific types of tokens
    ///////////////////////////////////////////////////////////////////////////

    'ALL': function (token, count) {
        // First token should be {
        if (count === 1 && token.type !== TokenType.GROUP_START) {
            throw new Error('File should start with "{"');
        }

        // Second token should be \rtf1
        if (count === 2 && (token.word !== 'rtf' || (token.param !== 0 && token.param !== 1))) {
            throw new Error('File should start with "{\\rtf[0,1]"');
        }

        if (count > 10 && !this._fromhtml && !this._fromtext) {
            throw this._getModeError();
        }

        // Warn and skip if we have any tokens after final }
        if (this._done) {
            this._options.warn('Additional tokens after final closing bracket');
            return true;
        }
    },

    [TokenType.GROUP_START]: function (token: GroupStartToken) {
        this._skip = 0;

        // Handle first state
        if (!this._state) {
            this._state = { uc: 1 };
        } else {
            // Make new state based on current
            const oldState = this._state;
            const newState = Object.create(oldState);
            newState.ancDestIgnorable = oldState.ancDestIgnorable || oldState.destIgnorable;
            this._state = newState;
        }
    },

    [TokenType.GROUP_END]: function (token: GroupEndToken) {
        this._skip = 0;
        this._state = Object.getPrototypeOf(this._state);
        if (this._state === this._rootState) {
            this._done = true;
        }
    },

    [TokenType.CONTROL]: function (token: ControlToken) {
        // Skip the control token if skipping after \u
        if (this._skip > 0) {
            this._skip--;
            return true;
        }
    },

    [TokenType.TEXT]: function (token: TextToken, count) {
        if (count <= 10) {
            throw this._getModeError();
        }

        // Check if we should be skipping the whole text...
        if (this._skip >= token.data.length) {
            this._skip -= token.data.length;
            return true;
        }

        // We are skipping some, slice the data!
        if (this._skip > 0) {
            token.data = token.data.slice(this._skip);
            this._skip = 0;
        }

        this._doText(token.data);
    },

    ///////////////////////////////////////////////////////////////////////////
    // Handlers based on type of CONTROL token (symbol vs destination)
    ///////////////////////////////////////////////////////////////////////////

    // Use this method to handle basic text escapes
    ['_' + WordType.SYMBOL]: function (token) {
        const text = escapes[token.word || ''];
        if (text) {
            this._doText(text);
        }
    },

    ['_' + WordType.DESTINATION]: function (token) {
        if (token.word === 'fonttbl') {
            if (this._fonttbl) {
                throw new Error('fonttbl already created');
            } else if (this._state.destination !== 'rtf') {
                throw new Error('fonttbl not in header');
            }
            this._fonttbl = {};
        }

        if (this._lastToken && this._lastToken.type === TokenType.GROUP_START) {
            // Handles htmltag destination
            this._state.destination = token.word;
            this._state.destIgnorable = false;
        } else if (this._lastToken && this._lastLastToken
            && this._lastToken.type === TokenType.CONTROL && this._lastToken.word === '*'
            && this._lastLastToken.type === TokenType.GROUP_START) {
            this._state.destination = token.word;
            this._state.destIgnorable = true;
        } else {
            this._options.warn('Got destination control word but not immediately after "{" or "{\\*": ' + token.word);
        }
    },

    // For control words that are unknown... check if they appear to be
    // optional destinations (because then will ignore any text)
    ['_' + WordType.UNKNOWN]: function (token) {
        if (this._lastToken && this._lastLastToken
            && this._lastToken.type === TokenType.CONTROL && this._lastToken.word === '*'
            && this._lastLastToken.type === TokenType.GROUP_START) {
            this._state.destination = token.word;
            this._state.destIgnorable = true;
        }
    },

    ///////////////////////////////////////////////////////////////////////////
    // Handlers for specific CONTROL words / symbols
    ///////////////////////////////////////////////////////////////////////////
    '__mac': function (token) {
        throw new Error('Unsupported character set \\mac');
    },
    '__pc': function (token) {
        throw new Error('Unsupported character set \\pc');
    },
    '__pca': function (token) {
        throw new Error('Unsupported character set \\pca');
    },

    '__fromhtml': function (token) {
        if (this._state.destination !== 'rtf') {
            throw new Error('\\fromhtml not at root group');
        }
        if (this._fromhtml !== false || this._fromtext !== false) {
            throw new Error('\\fromhtml or \\fromtext already defined');
        }
        if (this._options.mode !== 'html' && this._options.mode !== 'either') {
            throw this._getModeError();
        }

        this._fromhtml = true;
        if (this._options.prefix) {
            this.push('html:');
        }
    },

    '__fromtext': function (token) {
        if (this._state.destination !== 'rtf') {
            throw new Error('\\fromtext not at root group');
        }
        if (this._fromhtml !== false || this._fromtext !== false) {
            throw new Error('\\fromhtml or \\fromtext already defined');
        }
        if (this._options.mode !== 'text' && this._options.mode !== 'either') {
            throw this._getModeError();
        }

        this._fromtext = true;
        if (this._options.prefix) {
            this.push('text:');
        }
    },

    '__ansicpg': function (token) {
        if (this._state.destination !== 'rtf') {
            throw new Error('\\ansicpg not at root group');
        }
        if (this._ansicpg) {
            throw new Error('\\ansicpg already defined');
        }
        if (!isNum(token.param)) {
            throw new Error('\\ansicpg with no param');
        }

        this._ansicpg = true;
        this._cpg = token.param;
    },

    '__deff': function (token) {
        if (this._state.destination !== 'rtf')
            throw new Error('\\deff not at root group');
        if (typeof this._deff !== 'undefined')
            throw new Error('\\deff already defined');

        this._deff = token.param + '';
    },

    // Handle font selection & font table
    '__f': function (token) {
        if (typeof token.param === 'undefined') {
            throw new Error('No param for \\f');
        }

        const f = token.param + '';

        if (this._state.destination === 'fonttbl') {
            // Create font table entry
            this._fonttbl = this._fonttbl || {};
            this._fonttbl[f] = this._fonttbl[f] || {};
        } else if (!this._fonttbl || !this._fonttbl[f]) {
            throw new Error('\\f control word for unknown font ' + f);
        }

        // Set current font
        this._state.font = f;
    },

    '__fcharset': function (token) {
        if (this._state.destination !== 'fonttbl' || !this._fonttbl) {
            throw new Error('fcharset not in fonttbl');
        }

        const f = this._state.font;
        const fontEntry = f && this._fonttbl[f];
        if (!f || !fontEntry) {
            throw new Error('fcharset with no current font');
        }

        if (!isNum(token.param)) {
            throw new Error('fcharset with no param');
        }

        if (token.param !== 1) {
            const cpg = charsetToCpg[token.param];
            if (!isNum(cpg)) {
                this._options.warn('No codepage for charset ' + token.param);
            } else {
                fontEntry.fcharsetCpg = cpg;
            }
        }
    },

    '__cpg': function (token) {
        if (this._state.destination !== 'fonttbl' || !this._fonttbl)
            throw new Error('cpg not in fonttbl');

        const f = this._state.font;
        const fontEntry = f && this._fonttbl[f];
        if (!f || !fontEntry) {
            throw new Error('cpg with no current font');
        }

        const cpg = token.param;
        if (!isNum(cpg)) {
            this._options.warn('No codepage given');
        } else {
            fontEntry.cpg = cpg;
        }
    },

    // \flomajor | \fhimajor | \fdbmajor | \fbimajor | \flominor | \fhiminor | \fdbminor | \fbiminor
    '__flomajor': handleThemefont,
    '__fhimajor': handleThemefont,
    '__fdbmajor': handleThemefont,
    '__fbimajor': handleThemefont,
    '__flominor': handleThemefont,
    '__fhiminor': handleThemefont,
    '__fdbminor': handleThemefont,
    '__fbiminor': handleThemefont,


    // \fnil | \froman | \fswiss | \fmodern | \fscript | \fdecor | \ftech | \fbidi
    '__fnil': handleFontfamily,
    '__froman': handleFontfamily,
    '__fswiss': handleFontfamily,
    '__fmodern': handleFontfamily,
    '__fscript': handleFontfamily,
    '__fdecor': handleFontfamily,
    '__ftech': handleFontfamily,
    '__fbidi': handleFontfamily,


    // Handle byte escapes
    "__'": function (token) {
        this._doText(token.data as Buffer);
    },

    // Handle Unicode escapes
    '__uc': function (token) {
        this._state.uc = token.param || 0;
    },

    '__u': function (token) {
        if (!isNum(token.param)) {
            throw new Error('Unicode control word with no param');
        }

        if (token.param < 0) {
            this._doText(String.fromCodePoint(token.param + 0x10000));
        } else {
            this._doText(String.fromCodePoint(token.param));
        }

        this._skip = this._state.uc;
    },

    '__htmlrtf': function (token) {
        // Outside htmltag, surpression tags
        if (this._state.destination !== 'htmltag') {
            const on = token.param !== 0;
            this._state.htmlrtf = on;
        } else {
            this._options.warn('htmlrtf control word inside htmltag');
        }
    }
};

const enum BufferedType {
    Unicode,
    Codepage,
    Font,
    Symbol
}

interface BufferedBase {
    type: BufferedType;
    inHtmlTag: boolean;
    data: Buffer[] | string[] | (Buffer | string)[];
}

interface BufferedUnicodeText extends BufferedBase {
    type: BufferedType.Unicode;
    data: string[];
}

interface BufferedCodepageText extends BufferedBase {
    type: BufferedType.Codepage;
    data: Buffer[];
    codepage: number;
}

interface BufferedFontText extends BufferedBase {
    type: BufferedType.Font;
    data: Buffer[];
    font: Readonly<FontTableEntry>;
}

interface BufferedSymbolText extends BufferedBase {
    type: BufferedType.Symbol;
    data: (Buffer | string)[];
    font: Readonly<FontTableEntry>;
}

type BufferedOutput = BufferedUnicodeText | BufferedCodepageText | BufferedFontText | BufferedSymbolText;

const rxCharset = /(\bcharset=)([\w-]+)(")/i;

export class DeEncapsulate extends Transform {

    public _options: NeededOptions;

    // These members are all public to allow the handler functions to access without TS complaining...
    public readonly _rootState: State = { uc: 1 };
    public _state: State = this._rootState;

    public _cpg = 1252;
    public _count = 0;
    public _lastLastToken: Token | null | undefined = null;
    public _lastToken: Token | null | undefined = null;
    public _fromhtml = false;
    public _fromtext = false;
    public _didHtmlCharsetReplace = false;
    public _originalHtmlCharset: string | undefined;
    public _done = false;
    public _ansicpg = false;
    public _deff: string;
    public _fonttbl: FontTable | undefined;

    // Represents how many tokens left to skip after \u
    public _skip = 0;

    // Some text encodings can't be decoded byte by byte, so we buffer sequential text outputs
    public _bufferedOutput: BufferedOutput | undefined;

    /**
     * @param {('text'|'html'|'either')-} mode Whether to de-encapsulate only text, html, or both. Will emit an error if stream doesn't match. Defaults to html.
     * @param {boolean} prefix Whether to prefix the output text with "html:" or "text:" depending on the encapsulation mode
     */
    constructor(options?: Options) {
        super({ writableObjectMode: true, readableObjectMode: true });
        this._options = {
            ...defaultOptions,
            ...options
        };
    }

    get isHtml() {
        return this._fromhtml;
    }

    get isText() {
        return this._fromtext;
    }

    get originalHtmlCharset() {
        return this._originalHtmlCharset;
    }

    get defaultCodepage() {
        return this._cpg;
    }

    _flushBuffer() {
        const bufd = this._bufferedOutput;
        if (!bufd) {
            return;
        }

        //console.log(`${bufd.type}: ${bufd.data}`);

        let out: string;
        let areSymbolFontCodepoints = false;

        switch (bufd.type) {
            case BufferedType.Unicode: {
                out = bufd.data.join('');
                break;
            }
            case BufferedType.Symbol: {
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

                const fontname = bufd.font.fontname;
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
            case BufferedType.Codepage:
            case BufferedType.Font: {
                const cpg = bufd.type === BufferedType.Codepage
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

        if (bufd.inHtmlTag && this._options.htmlFixContentType && !this._didHtmlCharsetReplace) {
            out = out.replace(rxCharset, (match, pre, charset, post) => {
                this._didHtmlCharsetReplace = true;
                this._originalHtmlCharset = charset;
                return pre + 'UTF-8' + post;
            });
        }

        if (this._fromhtml && this._options.htmlEncodeNonAscii) {
            out = htmlEntityEncode(out);
        }

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

    _getModeError() {
        if (this._options.mode === 'html') {
            return new Error('Not encapsulated HTML file');
        } else if (this._options.mode === 'text') {
            return new Error('Not encapsulated text file');
        } else {
            return new Error('Not encapsulated HTML or text file');
        }
    }

    _getDestStack() {
        let stack = [];
        let ignorable = false;

        let state = this._state;
        while (state && state !== Object.prototype) {
            if (state.destination) {
                stack.unshift(state.destination);
                if (state.destIgnorable) {
                    ignorable = true;
                }
            }

            state = Object.getPrototypeOf(state);
        }

        return {
            stack: stack,
            ignorable: ignorable
        };
    }

    _getCurrentFont() {
        const state = this._state;
        // Get current font's cpg, or default
        const f = state.font || this._deff;
        const finfo = this._fonttbl && this._fonttbl[f];
        return finfo;

    }

    // Outputs Unicode text if in the proper state
    _doText(data: Buffer | string) {
        // Handle font names
        if (this._state.destination === 'fonttbl') {
            const f = this._state.font;
            const fontEntry = f && this._fonttbl && this._fonttbl[f];

            if (!f || !fontEntry) {
                throw new Error('font text with no current font');
            }

            // Has trailing semicolon
            if (!isStr(data)) {
                data = data.toString('latin1');
            }

            // It's hard to know the proper encoding at this point, so replace any non-ASCII chars
            // with string escapes
            data = data.replace(/[^\x00-\x7F]/g, c => {
                const hex = c.charCodeAt(0).toString(16).toUpperCase();
                return '\\u' + '0000'.slice(0, 4 - hex.length) + hex;
            });

            let str = (fontEntry.fontname || '') + data;

            if (str.endsWith(';')) {
                str = str.substr(0, str.length - 1);

                // Trim quotes
                if (str.length > 2 && str.startsWith('"') && str.endsWith('"')) {
                    str = str.substr(1, str.length - 2);
                }
            }

            fontEntry.fontname = str;
            return;
        }

        const { stack, ignorable } = this._getDestStack();

        const insideHtmltag = stack.indexOf('htmltag') >= 0;

        // Outside of htmltag, ignore anything in htmlrtf group
        if (!insideHtmltag && this._state.htmlrtf) {
            return;
        }

        // Outside of htmltag, ignore anything in ignorable group
        if (!insideHtmltag && ignorable) {
            return;
        }

        // Outside of htmltag, ignore anything in known non-output groups
        if (!insideHtmltag && (stack.indexOf('fonttbl') >= 0 || stack.indexOf('colortbl') >= 0 || stack.indexOf('pntext') >= 0)) {
            return;
        }

        const thisFont = !insideHtmltag && this._getCurrentFont();
        const bufd = this._bufferedOutput;

        // Symbol fonts need to be treated as font codepoints regardless of if given with Unicode or not
        if (thisFont && (
            thisFont.fcharsetCpg === 42
            || thisFont.cpg === 42
            || (thisFont.fontname && knownSymbolFontNames[thisFont.fontname]))
        ) {
            // Handle a new symbol-font-based output piece
            if (bufd && bufd.type === BufferedType.Symbol && bufd.inHtmlTag === insideHtmltag && bufd.font === thisFont) {
                bufd.data.push(data);
            } else {
                if (bufd) {
                    this._flushBuffer();
                }
                this._bufferedOutput = {
                    type: BufferedType.Symbol,
                    inHtmlTag: insideHtmltag,
                    font: thisFont,
                    data: [data],
                };
            }
        } else if (isStr(data)) {
            // Handle a new string output piece
            if (bufd && bufd.type === BufferedType.Unicode && bufd.inHtmlTag === insideHtmltag) {
                bufd.data.push(data);
            } else {
                if (bufd) {
                    this._flushBuffer();
                }
                this._bufferedOutput = {
                    type: BufferedType.Unicode,
                    inHtmlTag: insideHtmltag,
                    data: [data],
                };
            }
        } else if (thisFont) {
            // Handle a new font-based output piece
            if (bufd && bufd.type === BufferedType.Font && bufd.inHtmlTag === insideHtmltag && bufd.font === thisFont) {
                bufd.data.push(data);
            } else {
                if (bufd) {
                    this._flushBuffer();
                }
                this._bufferedOutput = {
                    type: BufferedType.Font,
                    inHtmlTag: insideHtmltag,
                    font: thisFont,
                    data: [data]
                };
            }
        } else {
            // Handle a new default codepage output piece
            const thisCodepage = this._cpg;
            if (bufd && bufd.type === BufferedType.Codepage && bufd.inHtmlTag === insideHtmltag && bufd.codepage === thisCodepage) {
                bufd.data.push(data);
            } else {
                if (bufd) {
                    this._flushBuffer();
                }
                this._bufferedOutput = {
                    type: BufferedType.Codepage,
                    inHtmlTag: insideHtmltag,
                    codepage: thisCodepage,
                    data: [data]
                };
            }
        }
    }

    _handleToken(token: Token) {
        this._count++;

        const fnames = ['ALL', token.type];
        if (token.type === TokenType.CONTROL) {
            const wordType = words[token.word] || WordType.UNKNOWN;
            fnames.push('_' + wordType);
            fnames.push('__' + token.word);
        }

        try {
            for (let fname of fnames) {
                if (handlers[fname]) {
                    const done = handlers[fname].call(this, token, this._count);
                    if (done)
                        break;
                }
            }
        } catch (err) {
            return err;
        }

        this._lastLastToken = this._lastToken;
        this._lastToken = token;
    }

    _transform(token: Token, encoding: string | undefined, cb: (error?: any) => void) {
        const error = this._handleToken(token);
        cb(error);
    }

    _flush(cb: (error?: any) => void) {
        let error;

        if (this._count === 0) {
            error = new Error('File should start with "{"');
        } else if (this._count === 1) {
            error = new Error('File should start with "{\\rtf"');
        } else if (!this._fromhtml && !this._fromtext) {
            error = this._getModeError();
        } else if (this._state !== this._rootState) {
            this._options.warn('Not enough matching closing brackets');
        }

        this._flushBuffer();

        cb(error);
    }
}

export default DeEncapsulate;