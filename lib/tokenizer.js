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
      if (token.param)
        token.param = parseInt(token.param, 10);

      // Shorten buffer if extra space (text or early buffer termination)
      if (token.data) {
         if (token.data.length > token.length) {
            token.data = token.data.slice(0, token.length);
         }

         // The buffer is the right length now, so don't need length prop
         delete token.length;
         delete token.nibbles;
      }

      this.push(token);
    }

    // Reset state
    this._mode = modes.NORMAL;
  }

  _handleSpecialOrPush() {
    const param = Number.parseInt(this._token.param, 10) || 0;

    if (this._token.word === 'bin' && param > 0) {
      this._mode = modes.BINARY;
      this._token.data = new Buffer(param);
      this._token.data.fill(0);
      this._token.length = 0;
    } else if (this._token.word === '\'') {
      this._mode = modes.HEX;
      this._token.data = new Buffer(1);
      this._token.data.fill(0);
      this._token.nibbles = 0;
      this._token.length = 0;
    } else {
      this._flushToken();
    }
  }

  _handleByte(c) {
    // Warn about any 8-bit values not in BINARY section
    if (this._mode !== modes.BINARY && c >= 128) {
      console.warn('8-bit value found: ' + c);
    }

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

      case modes.HEX: {
        const token = this._token;
        token.nibbles++;

        let byte = parseInt(String.fromCharCode(c), 16);
        if (isNaN(byte)) {
          console.warn('Bad hex digit');
        } else {
          if (token.nibbles === 1)
            byte *= 16;

          token.data[0] += byte;
        }

        // End HEX if we've eaten all the bytes
        if (token.nibbles >= token.data.length * 2) {
          token.length = 1;
          this._flushToken();
        }

        break;
      }

      // If processing first char after a \...
      case modes.CONTROL_START: {
        // Check for control symbol
        if (!isAlpha(c)) {
          this._token = {
            type: 'WORD',
            word: String.fromCharCode(c)
          };

          this._handleSpecialOrPush();

          // this._token remains null
        } else {
          // First letter of control word... switch state
          this._mode = modes.CONTROL_WORD;
          this._token = {
            type: 'WORD',
            word: String.fromCharCode(c)
          };
        }
        break;
      }

      case modes.CONTROL_WORD: {
        // this._token is of type 'WORD'
        // If alpha, buffer word
        if (isAlpha(c)) {
          this._token.word += String.fromCharCode(c);
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
            const token = this._token;

            // Start or append to text token
            if (!token) {
              // Allocate 256 bytes
              this._token = {
                type: 'TEXT',
                data: new Buffer(256),
                length: 1
              };
              this._token.data[0] = c;
            } else if (token && token.type === 'TEXT') {
              // Resize the buffer if needed
              if (token.length >= token.data.length) {
                token.data = Buffer.concat([token.data, new Buffer(256)]);
              }

              // Add to the buffer
              this._token.data[token.length++] = c;
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
    try {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        this._handleByte(c);
      }
    } catch (err) {
      return cb(err);
    }

    cb();
  }

  _flush(cb) {
    this._flushToken();
    cb();
  }
}

module.exports = RTFParser;
