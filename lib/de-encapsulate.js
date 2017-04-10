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
    this._state = null;

    // Represents how many tokens left to skip after \u
    this._skip = 0;
  }

  _getFontCpg() {
    const state = this._state;
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
  _doText(data) {
    const state = this._state;
    const inside = state.destination === 'htmltag';
    const outside = state.destination === 'rtf' && !state.htmlrtf;

    // Skip if not inside html tag or directly to rtf
    if (!inside && !outside)
      return;

    if (typeof data === 'string') {
      this.push(data);
    } else {
      const cpg = inside ? this._cpg : this._getFontCpg();
      this.push(iconv.decode(data, cpg));
    }
  }

  // Handlers
  _ALL(token, count) {
    // First token should be {
    if (count === 1 && token.type !== 'GROUP_START')
      throw new Error('File should start with "{"');

    // Second token should be \rtf1
    if (count === 2 && (token.word !== 'rtf' || token.param !== 1))
      throw new Error('File should start with "{\\rtf"');

    if (count > 10 && !this._fromhtml)
      throw new Error('Not encapsulated HTML file');

    // Warn and skip if we have any tokens after final }
    if (this._done) {
      console.warn('Additional tokens after final closing bracket');
      return true;
    }
  }

  _GROUP_START(token) {
    this._skip = 0;

    // Handle first state
    if (!this._state) {
      this._state = { uc: 1 };
    } else {
      // Make new state based on current
      this._state = Object.create(this._state);
    }
  }

  _GROUP_END(token) {
    this._skip = 0;
    const prev = Object.getPrototypeOf(this._state);
    if (prev === Object.prototype) {
      this._state = null;
      this._done = true;
    } else {
      this._state = prev;
    }
  }

  _CONTROL(token) {
    // Skip the control token if skipping after \u
    if (this._skip > 0) {
      this._skip--;
      return true;
    }
  }

  _TEXT(token, count) {
    if (count <= 10)
      throw new Error('Not encapsulated HTML file');

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
  }

  // Use this method to handle basic text escapes
  _symbol(token) {
    const text = escapes[token.word];
    if (text) {
      this._doText(text);
    }
  }

  _destination(token) {
    if (token.word === 'fonttbl' && this._state.destination !== 'rtf')
      throw new Error('fonttbl not in header');

    // Handles htmltag destination
    this._state.destination = token.word;
  }


  // Header control words
  __fromhtml(token) {
    if (this._state.destination !== 'rtf')
      throw new Error('\\fromhtml not at root group');
    if (typeof this._fromhtml !== 'undefined')
      throw new Error('\\fromhtml already defined');

    this._fromhtml = true;
  }

  __ansicpg(token) {
    if (this._state.destination !== 'rtf')
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

  __deff(token) {
    if (this._state.destination !== 'rtf')
      throw new Error('\\deff not at root group');
    if (typeof this._deff !== 'undefined')
      throw new Error('\\deff already defined');

    this._deff = token.param + '';
  }

  // Handle font selection & font table
  __f(token) {
    if (typeof token.param === 'undefined')
      throw new Error('No param for \\f');

    const f = token.param + '';

    if (this._state.destination === 'fonttbl') {
      // Create font table entry
      this._fonttbl = this._fonttbl || {};
      this._fonttbl[f] = this._fonttbl[f] || {};
    } else if (!this._fonttbl[f]) {
      throw new Error('\\f control word for unknown font ' + f);
    }

    // Set current font
    this._state.font = f;
  }

  __fcharset(token) {
    if (this._state.destination !== 'fonttbl')
      throw new Error('fcharset not in fonttbl');

    const f = this._state.font;
    if (!f)
      throw new Error('fcharset with no current font');

    const cpg = charsetToCpg[token.param];
    if (!cpg)
      console.warn('No codepage for charset ' + token.param);
    else
      this._fonttbl[f].charsetCpg = cpg;
  }

  __cpg(token) {
    if (this._state.destination !== 'fonttbl')
      throw new Error('cpg not in fonttbl');

    const f = this._state.font;
    if (!f)
      throw new Error('cpg with no current font');

    const cpg = token.param;
    if (!cpg)
      console.warn('No codepage given');
    else
      this._fonttbl[f].cpg = cpg;
  }

  // Handle byte escapes
  "__'"(token) {
    this._doText(token.data);
  }

  // Handle Unicode escapes
  __uc(token) {
    this._state.uc = token.param || 0;
  }

  __u(token) {
    if (token.param < 0)
      this._doText(String.fromCodePoint(token.param + 0x10000));
    else
      this._doText(String.fromCodePoint(token.param));

    this._skip = this._state.uc;
  }

  __htmlrtf(token) {
    // Outside htmltag, surpression tags
    if (this._state.destination !== 'htmltag') {
      const on = token.param !== 0;
      this._state['htmlrtf'] = on;
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
    if (token.type === 'CONTROL') {
      const info = words[token.word];
      if (info) {
        fnames.push('_' + info.type);
      }
      fnames.push('__' + token.word);
    }

    try {
      for (let fname of fnames) {
        if (this[fname]) {
          const done = this[fname](token, this._count);
          if (done)
            break;
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
    } else if (this._state) {
      console.warn('Not enough matching closing brackets');
    }

    cb(error);
  }
}

module.exports = DeEncapsulator;
