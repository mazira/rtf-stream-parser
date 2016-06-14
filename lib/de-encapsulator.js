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

const charsetToCpg = {
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

class DeEncapsulator extends Transform {
  constructor() {
    super({ writableObjectMode: true, encoding: 'utf8' });
    this._cpg = 1252;
    this._count = 0;
    this._state = {};
  }

  _getFontCpg(state) {
    // Get current font's cpg, or default
    const f = state.font || this._deff;
    const finfo = this._fonttbl && this._fonttbl[f];
    const fcpg = finfo && (finfo.cpg || finfo.charsetCpg);

    // Use font cpg if we can decode it
    if (fcpg && iconv.encodingExists(fcpg)) {
      return fcpg;
    } else if (fcpg) {
      console.warn('Unsupported code page: ' + fcpg);
    }

    return this._cpg;
  }

  // Outputs Unicode text if in the proper state
  _doText(data, state) {
    const inside = state.destination === 'htmltag';
    const outside = state.destination === 'rtf' && !state.htmlrtf;

    // Skip if not inside html tag or directly to rtf
    if (!inside && !outside)
      return;

    if (typeof data === 'string') {
      this.push(data);
    } else {
      const cpg = inside ? this._cpg : this._getFontCpg(state);
      this.push(iconv.decode(data, cpg));
    }
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

    this._doText(token.data, state);
  }

  // Use this method to handle basic text escapes
  _symbol(token, state) {
    const text = escapes[token.word];
    if (text) {
      this._doText(text, state);
    }
  }

  _destination(token, state) {
    if (token.word === 'fonttbl' && state.destination !== 'rtf')
      throw new Error('fonttbl not in header');

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

  __deff(token, state) {
    if (state.destination !== 'rtf')
      throw new Error('\\deff not at root group');
    if (typeof this._deff !== 'undefined')
      throw new Error('\\deff already defined');

    this._deff = token.param + '';
  }

  // Handle selection
  __f(token, state) {
    if (typeof token.param === 'undefined')
      throw new Error('No param for \\f');

    const f = token.param + '';

    if (state.destination === 'fonttbl') {
      // Create font table entry
      this._fonttbl = this._fonttbl || {};
      this._fonttbl[f] = this._fonttbl[f] || {};
    } else if (!this._fonttbl[f]) {
      throw new Error('\\f control word for unknown font ' + f);
    }

    // Set current font
    state.font = f;
  }

  __fcharset(token, state) {
    if (state.destination !== 'fonttbl')
      throw new Error('fcharset not in fonttbl');

    const f = state.font;
    if (!f)
      throw new Error('fcharset with no current font');

    const cpg = charsetToCpg[token.param];
    if (!cpg)
      console.warn('No codepage for charset ' + token.param);
    else
      this._fonttbl[f].charsetCpg = cpg;
  }

  __cpg(token, state) {
    if (state.destination !== 'fonttbl')
      throw new Error('cpg not in fonttbl');

    const f = state.font;
    if (!f)
      throw new Error('cpg with no current font');

    const cpg = token.param;
    if (!cpg)
      console.warn('No codepage given');
    else
      this._fonttbl[f].cpg = cpg;
  }

  // Handle byte escapes
  "__'"(token, state) {
    this._doText(token.data, state);
  }

  // Handle Unicode escapes
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
