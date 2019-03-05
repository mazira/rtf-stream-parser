// Node
import { Transform } from 'stream';

// Module
import { Token, TokenType, TextToken, ControlToken, GroupEndToken, GroupStartToken } from './tokenize';
import { WordType, words } from './words';
import { isNum, isDef } from './utils';

export type Mode = 'text' | 'html' | 'either';
export type StringDecoder = (buf: Buffer, enc: string) => string;

export interface NeededOptions {
    decode: StringDecoder;
    mode: Mode;
    prefix: boolean;
    warn: (msg: string) => void;
}

export type Options = Partial<NeededOptions>;

export interface State {
    uc: number;
    destination?: string;
    ancDestIgnorable?: boolean;
    destIgnorable?: boolean;
    htmlrtf?: boolean;
    font?: string;
}

export interface FontTableEntry {
    cpg?: number;
    charsetCpg?: number;
}

export interface FontTable {
    [font: string]: FontTableEntry | undefined;
}

const nativeDecoder: StringDecoder = (buf, enc) => buf.toString(enc);
const defaultOptions: NeededOptions = {
    decode: nativeDecoder,
    mode: 'html',
    prefix: false,
    warn: console.warn
}

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
    255: 850
};

type Handler = (this: DeEncapsulate, token: Token, count: number) => void;

const handlers: { [key: string]: Handler } = {
    ///////////////////////////////////////////////////////////////////////////
    // Handlers for specific types of tokens
    ///////////////////////////////////////////////////////////////////////////

    'ALL': function (token, count) {
        // First token should be {
        if (count === 1 && token.type !== TokenType.GROUP_START)
            throw new Error('File should start with "{"');

        // Second token should be \rtf1
        if (count === 2 && (token.word !== 'rtf' || token.param !== 1))
            throw new Error('File should start with "{\\rtf"');

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
        if (token.word === 'fonttbl' && this._state.destination !== 'rtf') {
            throw new Error('fonttbl not in header');
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
            throw new Error('Got destination control word but not immediately after "{" or "{\\*"');
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
        if (typeof token.param === 'undefined')
            throw new Error('No param for \\f');

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
        if (this._state.destination !== 'fonttbl' || !this._fonttbl)
            throw new Error('fcharset not in fonttbl');

        const f = this._state.font;
        const fontEntry = f && this._fonttbl[f];
        if (!f || !fontEntry) {
            throw new Error('fcharset with no current font');
        }

        if (!isNum(token.param)) {
            throw new Error('fcharset with no param');
        }

        const cpg = charsetToCpg[token.param];
        if (!isNum(cpg)) {
            this._options.warn('No codepage for charset ' + token.param);
        } else {
            fontEntry.charsetCpg = cpg;
        }
    },

    '__cpg': function (token) {
        if (this._state.destination !== 'fonttbl' || !this._fonttbl)
            throw new Error('cpg not in fonttbl');

        const f = this._state.font;
        const fontEntry = f && this._fonttbl[f];
        if (!f || !fontEntry)
            throw new Error('cpg with no current font');

        const cpg = token.param;
        if (!isNum(cpg)) {
            this._options.warn('No codepage given');
        } else {
            fontEntry.cpg = cpg;
        }
    },

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
    public _done = false;
    public _ansicpg = false;
    public _deff: string;
    public _fonttbl: FontTable | undefined;

    // Represents how many tokens left to skip after \u
    public _skip = 0;

    // Some text encodings can't be decoded byte by byte, so we buffer sequential text outputs
    public _bufferedOutput: Buffer[] = [];
    public _bufferedCpg: number | undefined;


    /**
     * @param {('text'|'html'|'either')-} mode Whether to de-encapsulate only text, html, or both. Will emit an error if stream doesn't match. Defaults to html.
     * @param {boolean} prefix Whether to prefix the output text with "html:" or "text:" depending on the encapsulation mode
     */
    constructor(options: Options) {
        super({ writableObjectMode: true, encoding: 'utf8' });
        this._options = {
            ...defaultOptions,
        };

        if (isDef(options.decode)) {
            this._options.decode = options.decode;
        }
        if (isDef(options.mode)) {
            this._options.mode = options.mode;
        }
        if (isDef(options.prefix)) {
            this._options.prefix = options.prefix;
        }
        if (isDef(options.warn)) {
            this._options.warn = options.warn;
        }
    }

    _flushText() {
        if (this._bufferedOutput.length) {
            const buf = Buffer.concat(this._bufferedOutput);

            try {
                let str: string;
                // Ascii && UTF-8
                if (this._bufferedCpg === 20127 || this._bufferedCpg === 65001) {
                    str = buf.toString('utf8');
                } else {
                    str = this._options.decode(buf, 'cp' + this._bufferedCpg);
                }
                this.push(str);
            } catch (err) {
                this._options.warn(`Unable to decode codepage ${this._bufferedCpg}`);
            }

            this._bufferedOutput = [];
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

    _getFontCpg() {
        const state = this._state;
        // Get current font's cpg, or default
        const f = state.font || this._deff;
        const finfo = this._fonttbl && this._fonttbl[f];
        const fcpg = finfo && (finfo.cpg || finfo.charsetCpg);

        // Use font cpg if we can decode it
        if (isNum(fcpg)) {
            return fcpg;
        } else {
            return this._cpg;
        }
    }

    // Outputs Unicode text if in the proper state
    _doText(data: Buffer | string) {
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

        if (typeof data === 'string') {
            this._flushText();
            this.push(data);
        } else {
            // Inside htmltag, decode using default codepage, otherwise use current font codepage
            const cpg = insideHtmltag ? this._cpg : this._getFontCpg();

            // If this is a different codepage than the buffered text, flush it
            if (this._bufferedOutput.length && this._bufferedCpg != cpg) {
                this._flushText();
            }

            // Buffer this new text
            this._bufferedOutput.push(data);
            this._bufferedCpg = cpg;
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

        this._flushText();

        cb(error);
    }
}

export default DeEncapsulate;