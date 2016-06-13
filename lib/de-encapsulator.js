'use strict';

// Node
const Transform = require('stream').Transform;

// Module
const words = require('./words.json');

class DeEncapsulator extends Transform {
  constructor() {
    super({ writableObjectMode: true, encoding: 'utf8' });
    this._count = 0;
    this._state = {};
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
      this.push(token.text);
    else if (state.destination === 'rtf' && !state.htmlrtf)
      this.push(token.text);
  }
  _destination(token, state) {
    // Handles htmltag destination
    state.destination = token.word;
  }
  __fromhtml(token, state) {
    if (state.destination !== 'rtf')
      throw new Error('\\fromhtml not at root group');
    if (typeof this._fromhtml !== 'undefined')
      throw new Error('\\fromhtml already defined');

    this._fromhtml = true;
  }
  __par(token, state) {
    if (state.destination === 'htmltag')
      this.push('\r\n');
    else if (state.destination === 'rtf' && !state.htmlrtf)
      this.push('\r\n');
  }
  __tab(token, state) {
    if (state.destination === 'htmltag')
      this.push('\t');
    else if (state.destination === 'rtf' && !state.htmlrtf)
      this.push('\t');
  }
  "__{"(token, state) {
    if (state.destination === 'htmltag')
      this.push('{');
    else if (state.destination === 'rtf' && !state.htmlrtf)
      this.push('{');
  }
  "__}"(token, state) {
    if (state.destination === 'htmltag')
      this.push('}');
    else if (state.destination === 'rtf' && !state.htmlrtf)
      this.push('}');
  }
  "__\\"(token, state) {
    if (state.destination === 'htmltag')
      this.push('\\');
    else if (state.destination === 'rtf' && !state.htmlrtf)
      this.push('\\');
  }
  __htmlrtf(token, state) {
    // Outside htmltag, surpression tags
    if (state.destination !== 'htmltag') {
      const on = token.param !== 0;
      state['htmlrtf'] = on;
    } else {
      throw new Error('htmlrtf control word inside htmltag');
    }
  }

  _handleToken(token) {
    let error;

    this._count++;

    const fnames = [
      '_ALL',
      '_' + token.type
    ];
    if (token.type === 'WORD' || token.type === 'SYMBOL') {
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
