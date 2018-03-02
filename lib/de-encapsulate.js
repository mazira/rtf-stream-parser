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
  /**
   * @param {('text'|'html'|'either')-} mode Whether to de-encapsulate only text, html, or both. Will emit an error if stream doesn't match. Defaults to html.
   * @param {boolean} prefix Whether to prefix the output text with "html:" or "text:" depending on the encapsulation mode
   */
  constructor(mode, prefix) {
    super({ writableObjectMode: true, encoding: 'utf8' });
    this._cpg = 1252;
    this._count = 0;
    this._lastLastToken = null;
    this._lastToken = null;
    this._state = null;
    this._mode = mode || 'html';
    this._prefix = prefix === true;
    this._fromhtml = false;
    this._fromtext = false;

    // Represents how many tokens left to skip after \u
    this._skip = 0;

    // Some text encodings can't be decoded byte by byte, so we buffer sequential text outputs
    this._bufferedOutput = [];
    this._bufferedCpg = null;
  }


  _flushText() {
    if (this._bufferedOutput.length) {
      const buf = Buffer.concat(this._bufferedOutput);

      const str = iconv.decode(buf, this._bufferedCpg);
      this.push(str);

      this._bufferedOutput = [];
    }
  }

  _getModeError() {
    if (this._mode === 'html') {
      return new Error('Not encapsulated HTML file');
    } else if (this._mode === 'text') {
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
    if (fcpg && iconv.encodingExists(fcpg)) {
      return fcpg;
    } else if (fcpg) {
      console.warn('Unsupported code page: ' + fcpg);
    }

    return this._cpg;
  }

  // Outputs Unicode text if in the proper state
  _doText(data) {
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
    if (!insideHtmltag && (stack.indexOf('fonttbl') >= 0 || stack.indexOf('colortbl') >= 0)) {
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

  // Handlers
  _ALL(token, count) {
    // First token should be {
    if (count === 1 && token.type !== 'GROUP_START')
      throw new Error('File should start with "{"');

    // Second token should be \rtf1
    if (count === 2 && (token.word !== 'rtf' || token.param !== 1))
      throw new Error('File should start with "{\\rtf"');

    if (count > 10 && !this._fromhtml && !this._fromtext) {
      throw this._getModeError();
    }

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
      const oldState = this._state;
      this._state = Object.create(oldState);
      this._state.ancDestIgnorable = oldState.ancDestIgnorable || oldState.destIgnorable;
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
  }

  // Use this method to handle basic text escapes
  _symbol(token) {
    const text = escapes[token.word];
    if (text) {
      this._doText(text);
    }
  }

  _destination(token) {
    if (token.word === 'fonttbl' && this._state.destination !== 'rtf') {
      throw new Error('fonttbl not in header');
    }

    if (this._lastToken && this._lastToken.type === 'GROUP_START') {
      // Handles htmltag destination
      this._state.destination = token.word;
      this._state.destIgnorable = false;
    } else if (this._lastToken && this._lastLastToken
      && this._lastToken.type === 'CONTROL' && this._lastToken.word === '*'
      && this._lastLastToken.type === 'GROUP_START') {
      this._state.destination = token.word;
      this._state.destIgnorable = true;
    } else {
      throw new Error('Got destination control word but not immediately after "\\" or "\\*"');
    }
  }

  // Header control words
  __fromhtml(token) {
    if (this._state.destination !== 'rtf') {
      throw new Error('\\fromhtml not at root group');
    }
    if (this._fromhtml !== false || this._fromtext !== false) {
      throw new Error('\\fromhtml or \\fromtext already defined');
    }
    if (this._mode !== 'html' && this._mode !== 'either') {
      throw this._getModeError();
    }

    this._fromhtml = true;
    if (this._prefix) {
      this.push('html:');
    }
  }

  __fromtext(token) {
    if (this._state.destination !== 'rtf') {
      throw new Error('\\fromtext not at root group');
    }
    if (this._fromhtml !== false || this._fromtext !== false) {
      throw new Error('\\fromhtml or \\fromtext already defined');
    }
    if (this._mode !== 'text' && this._mode !== 'either') {
      throw this._getModeError();
    }

    this._fromtext = true;
    if (this._prefix) {
      this.push('text:');
    }
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

    this._lastLastToken = this._lastToken;
    this._lastToken = token;
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
    } else if (!this._fromhtml && !this._fromtext) {
      error = this._getModeError();
    } else if (this._state) {
      console.warn('Not enough matching closing brackets');
    }

    this._flushText();

    cb(error);
  }
}

module.exports = DeEncapsulator;
