'use strict';

// Node
const Transform = require('stream').Transform;

// NPM
const iconv = require('iconv-lite');

// Module
const words = require('./words.json');

const escapes = {
  'par': '\r\n',
  'tab': '\t',
  '{': '{',
  '}': '}',
  '\\': '\\',
  'lquote': String.fromCodePoint(0x2018),
  'rquote': String.fromCodePoint(0x2019),
  'ldblquote': String.fromCodePoint(0x201C),
  'rdblquote': String.fromCodePoint(0x201D),
  'bullet': String.fromCodePoint(0x2022),
  'endash': String.fromCodePoint(0x2013),
  'emdash': String.fromCodePoint(0x2014),
  '~': String.fromCodePoint(0x00A0),
  '_': String.fromCodePoint(0x00AD)
};

class DeEncapsulator extends Transform {
  constructor() {
    super({ writableObjectMode: true, encoding: 'utf8' });
    this._cpg = 1252;
    this._count = 0;
    this._state = {};
  }

  // Outputs Unicode text if in the proper state
  _doText(text, state) {
    if (state.destination === 'htmltag')
      this.push(text);
    else if (state.destination === 'rtf' && !state.htmlrtf)
      this.push(text);
  }

  // Handlers
  _ALL(token, state, count) {
    // First token should be {
    if (count === 1 && token.type !== 'START_GROUP')
      throw new Error('File should start with "{"');

    // Second token should be \rtf1
    if (count === 2 && (token.word !== 'rtf' || token.param !== 1))
      throw new Error('File should start with "{\\rtf"');

    if (count > 10 && !this._fromhtml)
      throw new Error('Not encapsulated HTML file');
  }

  _START_GROUP(token, state) {
    return Object.create(state);
  }
  _END_GROUP(token, state) {
    return Object.getPrototypeOf(state);
  }
  _TEXT(token, state, count) {
    if (count <= 10)
      throw new Error('Not encapsulated HTML file');

    if (state.destination === 'htmltag')
      this.push(iconv.decode(token.data, this._cpg));
    else if (state.destination === 'rtf' && !state.htmlrtf)
      this.push(iconv.decode(token.data, this._cpg));
  }

  // Use this method to handle basic text escapes
  _symbol(token, state) {
    const text = escapes[token.word];
    if (text) {
      this._doText(text, state);
    }
  }

  _destination(token, state) {
    // Handles htmltag destination
    state.destination = token.word;
  }

  // Header control words
  __fromhtml(token, state) {
    if (state.destination !== 'rtf')
      throw new Error('\\fromhtml not at root group');
    if (typeof this._fromhtml !== 'undefined')
      throw new Error('\\fromhtml already defined');

    this._fromhtml = true;
  }

  __ansicpg(token, state) {
    if (state.destination !== 'rtf')
      throw new Error('\\ansicpg not at root group');
    if (typeof this._ansicpg !== 'undefined')
      throw new Error('\\ansicpg already defined');

    this._ansicpg = true;
    if (iconv.encodingExists(token.param)) {
      this._cpg = token.param;
    } else {
      console.warn('Default code page ' + token.param + ' not supported. Using Windows-1252.');
    }
  }

  "__'"(token, state) {
    this._doText(iconv.decode(token.data, this._cpg), state);
  }

  __u(token, state) {
    if (token.param < 0)
      this._doText(String.fromCodePoint(token.param + 0x10000), state);
    else
      this._doText(String.fromCodePoint(token.param), state);
  }

  __htmlrtf(token, state) {
    // Outside htmltag, surpression tags
    if (state.destination !== 'htmltag') {
      const on = token.param !== 0;
      state['htmlrtf'] = on;
    } else {
      console.warn('htmlrtf control word inside htmltag');
    }
  }

  _handleToken(token) {
    let error;

    this._count++;

    const fnames = [
      '_ALL',
      '_' + token.type
    ];
    if (token.type === 'WORD') {
      const info = words[token.word];
      if (info) {
        fnames.push('_' + info.type);
      }
      fnames.push('__' + token.word);
    }

    try {
      for (let fname of fnames) {
        if (this[fname]) {
          const state = this[fname](token, this._state, this._count);
          if (state)
            this._state = state;
        }
      }
    } catch (err) {
      return err;
    }
  }

  _transform(token, encoding, cb) {
    const error = this._handleToken(token);
    cb(error);
  }

  _flush(cb) {
    let error;

    if (this._count === 0) {
      error = new Error('File should start with "{"');
    } else if (this._count === 1) {
      error = new Error('File should start with "{\\rtf"');
    } else if (!this._fromhtml) {
      error = new Error('Not encapsulated HTML file');
    }

    cb(error);
  }
}

module.exports = DeEncapsulator;
