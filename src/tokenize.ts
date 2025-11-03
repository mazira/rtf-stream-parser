import { Transform } from 'stream';
import { isNum, isStr } from './utils';

export const enum Mode {
    NORMAL,
    CONTROL_START,
    CONTROL_WORD,
    CONTROL_PARAM,
    BINARY,
    HEX
}

export const enum TokenType {
    GROUP_START,
    GROUP_END,
    CONTROL,
    TEXT
}

export interface BaseToken {
    type: TokenType;
    word?: string;
    data?: Buffer;
    length?: number;
    param?: number;
}

export interface GroupStartToken extends BaseToken {
    type: TokenType.GROUP_START;
}

export interface GroupEndToken extends BaseToken {
    type: TokenType.GROUP_END;
}

export interface TextToken extends BaseToken {
    type: TokenType.TEXT;
    data: Buffer;
    length: number;
}

export interface ControlToken extends BaseToken {
    type: TokenType.CONTROL;
    word: string;
}

/*
export interface Token {
    type: TokenType;
    word: string;

    param?: string;
    data?: Buffer;

    length?: number;
    nibbles?: number;
}
*/
export type Token = GroupStartToken | GroupEndToken | TextToken | ControlToken;

const isAlpha = (c: number) => (c > 64 && c < 91) || (c > 96 && c < 123);
const isNumeric = (c: number) => c > 47 && c < 58;

export class Tokenize extends Transform {
    protected _mode: Mode | undefined;
    protected _token: Token | null | undefined;
    protected _expectedBinaryBytes = 0;
    protected _readHexDigitsCount = 0;
    protected _paramStr = '';

    constructor() {
        super({ readableObjectMode: true });
        this._mode = Mode.NORMAL;
    }

    _flushToken(): void {
        const token = this._token;

        if (token) {
            // Make param a number
            if (this._paramStr) {
                token.param = Number.parseInt(this._paramStr, 10);
            }

            // Shorten buffer if extra space (text or early buffer termination)
            const buf = token.data;
            if (buf) {
                if (buf.length > (token.length || 0)) {
                    token.data = buf.slice(0, token.length);
                }

                // The buffer is the right length now, so don't need length prop
                delete token.length;
            }

            this.push(token);
        }

        // Reset state
        this._token = null;
        this._readHexDigitsCount = 0;
        this._paramStr = '';

        this._mode = Mode.NORMAL;
    }

    _handleSpecialOrPush(): void {
        // We know we have a token here...
        const token = this._token as Token;
        const param = parseInt(this._paramStr || '0', 10) || 0;

        if (token.type === TokenType.CONTROL && token.word === 'bin' && param > 0) {
            this._mode = Mode.BINARY;
            token.data = Buffer.alloc(param);
            token.length = 0;
        } else if (token.type === TokenType.CONTROL && token.word === '\'') {
            this._mode = Mode.HEX;
            token.data = Buffer.alloc(1);
            token.length = 0;
            this._readHexDigitsCount = 0;
        } else {
            this._flushToken();
        }
    }

    _transform(chunk: Buffer | string, encoding: string | undefined, cb: (err?: any) => void): void {
        try {
            this.__transform(chunk, encoding);
        } catch (err) {
            return cb(err);
        }

        cb();
    }

    __transform(chunk: Buffer | string, encoding: string | undefined): void {
        const buf = isStr(chunk) ? Buffer.from(chunk, encoding as BufferEncoding) : chunk;
        const binStr = buf.toString('binary');

        const len = buf.length;
        for (let i = 0; i < len; i++) {
            const c = buf[i];

            switch (this._mode) {
                // If eating binary data, do it!
                case Mode.BINARY: {
                    const token = this._token as ControlToken;

                    if (token.data && isNum(token.length)) {
                        token.data[token.length++] = c;
                    }

                    // If we have filled the buffer, stop!
                    if (!isNum(token.length) || !token.data || token.length >= token.data.length) {
                        this._flushToken();
                    }
                    break;
                }

                case Mode.HEX: {
                    const token = this._token as ControlToken;

                    const byte = parseInt(String.fromCharCode(c), 16);

                    if (isNaN(byte) || !token.data) {
                        console.warn('Bad hex digit');
                    } else if (this._readHexDigitsCount === 0) {
                        token.data[0] += byte * 16;
                    } else {
                        token.data[0] += byte;
                    }

                    this._readHexDigitsCount++;

                    // End HEX if we've eaten all the bytes
                    if (this._readHexDigitsCount === 2) {
                        token.length = 1;
                        this._flushToken();
                    }

                    break;
                }

                // If processing first char after a \...
                case Mode.CONTROL_START: {
                    // Check for control symbol
                    if (!isAlpha(c)) {
                        this._token = {
                            type: TokenType.CONTROL,
                            word: String.fromCharCode(c)
                        };

                        this._handleSpecialOrPush();
                    } else {
                        // First letter of control word... switch state
                        this._mode = Mode.CONTROL_WORD;
                        this._token = {
                            type: TokenType.CONTROL,
                            word: String.fromCharCode(c)
                        };
                    }
                    break;
                }

                case Mode.CONTROL_WORD: {
                    // We are only switched to this state from CONTROL_START, so we know
                    // current token is a CONTROL type
                    const token = this._token as ControlToken;

                    // this._token is of type 'CONTROL'
                    // If alpha, buffer word
                    if (isAlpha(c)) {
                        token.word += String.fromCharCode(c);
                    }
                    // Check for number or negative sign
                    else if (isNumeric(c) || c === 45 /* - */) {
                        this._mode = Mode.CONTROL_PARAM;
                        this._paramStr = String.fromCharCode(c);
                    }
                    // End of control word, no param
                    else {
                        this._handleSpecialOrPush();

                        // Eat space... otherwise let char go again
                        if (c !== 32) {
                            i -= 1;
                        }
                        continue;
                    }
                    break;
                }

                case Mode.CONTROL_PARAM: {
                    // We are only switched to this state from CONTROL_START, so we know
                    // current token is a CONTROL type

                    // If alpha, buffer word
                    if (isNumeric(c)) {
                        this._paramStr += String.fromCharCode(c);
                    }
                    // End of control param
                    else {
                        this._handleSpecialOrPush();

                        // Eat space... otherwise let chars go again
                        if (c !== 32) {
                            i -= 1;
                        }
                        continue;
                    }
                    break;
                }

                case Mode.NORMAL: {
                    switch (c) {
                        case 123: // {
                            this._flushToken();
                            this.push({ type: TokenType.GROUP_START });
                            break;
                        case 125: // }
                            this._flushToken();
                            this.push({ type: TokenType.GROUP_END });
                            break;
                        case 92: // \
                            this._flushToken();
                            this._mode = Mode.CONTROL_START;
                            break;
                        case 13: // CR
                        case 10: // LF
                            break;
                        default: {
                            // We will take normal text from this char until next {}\\\r\n
                            // This regex approach seems about 12% faster than just
                            // iterating the Buffer
                            const start = i;
                            const rx = /[\r\n{}\\]/g;
                            rx.lastIndex = i;
                            const endMatch = rx.exec(binStr);

                            const end = endMatch ? endMatch.index : len;

                            const slice = buf.slice(start, end);
                            const token = this._token;

                            // Start or append to text token
                            if (!token) {
                                this._token = {
                                    type: TokenType.TEXT,
                                    data: slice,
                                    length: slice.length
                                };
                                i = end - 1;
                            } else if (token && token.type === TokenType.TEXT) {
                                token.length += slice.length;
                                token.data = Buffer.concat([token.data, slice], token.length);
                                i = end - 1;
                            } else {
                                throw new Error('Unpushed token!');
                            }
                        }
                    }
                    break;
                }

                default:
                    throw new Error('Unknown state!');
            }

        }
    }

    _flush(cb: () => void): void {
        this._flushToken();
        cb();
    }
}

export default Tokenize;
