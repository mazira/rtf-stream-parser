'use strict';

// Node
const Transform = require('stream').Transform;

// Module
const words = require('./words.json');

const modes = {
  HEADER: 0,
  GO: 1
};

class DeEncapsulator extends Transform {
  constructor() {
    super({ writableObjectMode: true, encoding: 'utf8' });
    this._mode = modes.HEADER;
    this._encapsulated = false;
    this._count = 0;

    this._state = {};
    this._stack = [];
  }

  _handleToken(token) {
    let error;

    if (this._mode === modes.HEADER) {
      this._count++;
      if (this._count === 1) {
        // First token should be {
        if (token.type !== 'START_GROUP') {
          error = new Error('File should start with "{"');
        }
      } else if (this._count === 2) {
        // Second token should be \rtf1
        if (token.type !== 'WORD' || token.value !== 'rtf' || token.param !== 1) {
          error = new Error('File should start with "{\\rtf"');
        }
      } else if (this._count <= 10) {
        // \fromtext should be within first 10 tokens
        if (token.type === 'WORD' && token.value === 'fromhtml' && token.param === 1) {
          this._encapsulated = true;
        } else if (token.type !== 'START_GROUP' && token.type !== 'WORD') {
          error = new Error('Not encapsulated HTML file');
        }
      }

      // If at 10th word, either we are good or we are not
      if (this._count === 10) {
        if (this._encapsulated) {
          this._mode = modes.GO;
        } else {
          error = new Error('Not encapsulated HTML file');
        }
      }
    }

    if (token.type ===  'START_GROUP') {
      this._state = Object.create(this._state);
    } else if (token.type === 'END_GROUP') {
      this._state = Object.getPrototypeOf(this._state);
    }
    // Inside htmltag
    else if (this._state.destination === 'htmltag') {
      if (token.type === 'WORD') {
        switch (token.value) {
          case "par": this.push('\r\n'); break;
          case "tab": this.push('\t'); break;
          case "{": this.push('{'); break;
          case "}": this.push('}'); break;
          case "\\": this.push('\\'); break;
          default:
            console.warn('Unused control word token inside htmltag');
            console.log(token);
        }
      } else if (token.type === 'TEXT') {
        this.push(token.value);
      }
    }
    // Outside htmltag, surpression tags
    else if (token.type === 'WORD' && token.value === 'htmlrtf') {
      const on = token.param !== 0;
      this._state['htmlrtf'] = on;
    }
    // Outside htmltag, not surpressed
    else if (!this._state.htmlrtf) {
      if (token.type === 'WORD') {
        const info = words[token.value];
        if (info && info.type === 'destination') {
          this._state.destination = token.value;
        }
      } else if (token.type === 'TEXT') {
        if (this._state.destination === 'rtf') {
          this.push(token.value);
        }
      } else {
        console.log('skipped unsurpressed token');
        console.log(token);
      }
    }

    return error;
  }

  _transform(token, encoding, cb) {
    const error = this._handleToken(token);
    cb(error);
  }

  _flush(cb) {
    let error;

    if (this._mode === modes.HEADER) {
      if (this._count === 0) {
        error = new Error('File should start with "{"');
      } else if (this._count === 1) {
        error = new Error('File should start with "{\\rtf"');
      } else if (!this._encapsulated) {
        error = new Error('Not encapsulated HTML file');
      }
    }

    cb(error);
  }
}

module.exports = DeEncapsulator;
