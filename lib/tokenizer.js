'use strict';

const Transform = require('stream').Transform;

const isAlpha    = (c) => (c > 64 && c < 91) || (c > 96 && c < 123);
const isNumeric  = (c) => c > 47 && c < 58;
const isAlphaNum = (c) => isAlpha(c) || isNumeric(c);

const modes = {
  NORMAL: 0,
  CONTROL_START: 1,
  CONTROL_WORD: 2,
  CONTROL_PARAM: 3,
  BINARY: 4,
  HEX: 5
};

const controlSymbolEscapes = {
  '\\': '\\',
  '{': '{',
  '}': '}',
  '\r': '\r',
  '\n': '\n',
  '\t': '\t'
};

class RTFParser extends Transform {
  constructor() {
    super({ readableObjectMode : true });
    this._mode = modes.NORMAL;
    this._token;
  }

  _flushToken() {
    const token = this._token;
    if (token) {
      this._token = null;

      // Make param a number
      if ( token.param )
        token.param = parseInt(token.param, 10);

      this.push(token);
    }

    // Reset state
    this._mode = modes.NORMAL;
  }

  _handleSpecialOrPush() {
    const param = Number.parseInt(this._token.param, 10) || 0;

    if (this._token.value === 'bin' && param > 0) {
      this._mode = modes.BINARY;
      this._token.data = new Buffer(param);
      this._token.length = 0;
    } else {
      this._flushToken();
    }
  }

  _handleByte(c) {
    switch (this._mode) {
      // If eating binary data, do it!
      case modes.BINARY: {
        const token = this._token;
        token.data[token.length++] = c;

        // If we have filled the buffer, stop!
        if (token.length >= token.data.length) {
          this._flushToken();
        }
        break;
      }

      // If processing first char after a \...
      case modes.CONTROL_START: {
        // Check for control symbol
        if (!isAlpha(c)) {
          // Stop buffering, prevent further processing of char
          const ch1 = String.fromCharCode(c);
          const ch2 = controlSymbolEscapes[ch1];

          if (ch2) {
            this.push({
              type: 'TEXT',
              value: ch2
            });
          } else {
            this.push({
              type: 'SYMBOL',
              value: String.fromCharCode(c)
            });
          }

          this._mode = modes.NORMAL;
          // this._token remains null
        } else {
          // First letter of control word... switch state
          this._mode = modes.CONTROL_WORD;
          this._token = {
            type: 'WORD',
            value: String.fromCharCode(c)
          };
        }
        break;
      }

      case modes.CONTROL_WORD: {
        // this._token is of type 'WORD'
        // If alpha, buffer word
        if (isAlpha(c)) {
          this._token.value += String.fromCharCode(c);
        }
        // Check for number or negative sign
        else if (isNumeric(c) || c === 45 /* - */) {
          this._mode = modes.CONTROL_PARAM;
          this._token.param = String.fromCharCode(c);
        }
        // End of control word, no param
        else {
          this._handleSpecialOrPush();

          // Eat space... otherwise let chars go again
          if (c !== 32)
            this._handleByte(c);
        }
        break;
      }

      case modes.CONTROL_PARAM: {
        // this._token is of type 'WORD' and has a 'param'
        // If alpha, buffer word
        if (isNumeric(c)) {
          this._token.param += String.fromCharCode(c);
        }
        // End of control param
        else {
          this._handleSpecialOrPush();

          // Eat space... otherwise let chars go again
          if (c !== 32)
            this._handleByte(c);
        }
        break;
      }

      case modes.NORMAL: {
        switch (c) {
          case 123: // {
            this._flushToken();
            this.push({ type: 'START_GROUP' });
            break;
          case 125: // }
            this._flushToken();
            this.push({ type: 'END_GROUP' });
            break;
          case 92: // \
            this._flushToken();
            this._mode = modes.CONTROL_START;
            break;
          case 13: // CR
          case 10: // LF
            break;
          default: {
            // Start or append to text token
            if (!this._token) {
              this._token = {
                type: 'TEXT',
                value: String.fromCharCode(c)
              };
            } else if (this._token && this._token.type === 'TEXT') {
              this._token.value += String.fromCharCode(c);
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

  _transform(chunk, encoding, cb) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      this._handleByte(c);
    }

    cb();
  }

  _flush(cb) {
    this._flushToken();
    cb();
  }
}

module.exports = RTFParser;
