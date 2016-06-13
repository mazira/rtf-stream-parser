'use strict';

// NPM
const co = require('bluebird').coroutine;
const expect = require('chai').expect;

// Module
const Tokenizer = require('../lib/tokenizer');
const utils = require('./utils');

describe('RTFParser', function () {
  function process(inputs) {
    return utils.streamFlow([new Tokenizer()], inputs);
  }

  describe('tokenization', function () {
    it('should allow uppercase and lowercase control words', co(function* () {
      const result = yield process(['\\word\\WoRd']);
      expect(result).to.be.an('array').of.length(2);
      expect(result[0]).to.eql({type: 'WORD', word: 'word'});
      expect(result[1]).to.eql({type: 'WORD', word: 'WoRd'});
    }));

    it('should find control words across chunks', co(function* () {
      const result = yield process(['\\wo', 'rd\\WoRd']);
      expect(result).to.be.an('array').of.length(2);
      expect(result[0]).to.eql({type: 'WORD', word: 'word'});
      expect(result[1]).to.eql({type: 'WORD', word: 'WoRd'});
    }));

    it('should eat the optional space after control words', co(function* () {
      const result = yield process(['\\word \\WoRd  ']);
      expect(result).to.be.an('array').of.length(3);
      expect(result[0]).to.eql({type: 'WORD', word: 'word'});
      expect(result[1]).to.eql({type: 'WORD', word: 'WoRd'});
      expect(result[2]).to.eql({type: 'TEXT', text: ' '});
    }));

    it('should not eat spaces after control sysmbols', co(function* () {
      const result = yield process(['\\{ \\}  ']);
      expect(result).to.be.an('array').of.length(4);
      expect(result[0]).to.eql({type: 'SYMBOL', word: '{'});
      expect(result[1]).to.eql({type: 'TEXT', text: ' '});
      expect(result[2]).to.eql({type: 'SYMBOL', word: '}'});
      expect(result[3]).to.eql({type: 'TEXT', text: '  '});
    }));

    it('should allow control word numerical param', co(function* () {
      const result = yield process(['\\word001\\WoRd123']);
      expect(result).to.be.an('array').of.length(2);
      expect(result[0]).to.eql({type: 'WORD', word: 'word', param: 1});
      expect(result[1]).to.eql({type: 'WORD', word: 'WoRd', param: 123});
    }));

    it('should allow negative control word numerical param', co(function* () {
      const result = yield process(['\\word-001\\WoRd-123']);
      expect(result).to.be.an('array').of.length(2);
      expect(result[0]).to.eql({type: 'WORD', word: 'word', param: -1});
      expect(result[1]).to.eql({type: 'WORD', word: 'WoRd', param: -123});
    }));

    it('should return control symbols with "word" property', co(function* () {
      const result = yield process(['\\word0 hi\\', '{\\\\\\', '}']);
      expect(result).to.be.an('array').of.length(5);
      expect(result[0]).to.eql({type: 'WORD', word: 'word', param: 0});
      expect(result[1]).to.eql({type: 'TEXT', text: 'hi'});
      expect(result[2]).to.eql({type: 'SYMBOL', word: '{'});
      expect(result[3]).to.eql({type: 'SYMBOL', word: '\\'});
      expect(result[4]).to.eql({type: 'SYMBOL', word: '}'});
    }));

    it('should not detect control words in binary data', co(function* () {
      const result = yield process(['\\bin', '4 \\hi2\\hi3']);
      expect(result).to.be.an('array').of.length(2);

      const buf = new Buffer('\\hi2');
      expect(result[0]).to.eql({type: 'WORD', word: 'bin', param: 4, data: buf, length: 4});
      expect(result[1]).to.eql({type: 'WORD', word: 'hi', param: 3});
    }));

    it('should handle \\bin control word without positive param', co(function* () {
      const result = yield process(['\\bin ', '\\bin0 \\bin-10 ']);
      expect(result).to.be.an('array').of.length(3);

      expect(result[0]).to.eql({type: 'WORD', word: 'bin'});
      expect(result[1]).to.eql({type: 'WORD', word: 'bin', param: 0});
      expect(result[2]).to.eql({type: 'WORD', word: 'bin', param: -10});
    }));

    it('should handle \\bin control with early EOF', co(function* () {
      const result = yield process(['\\bin10 hi']);
      expect(result).to.be.an('array').of.length(1);

      expect(result[0]).to.have.property('word', 'bin');
      expect(result[0]).to.have.property('param', 10);
      expect(result[0]).to.have.property('length', 2);
      expect(result[0]).to.have.property('data');
      expect(result[0].data.toString('ascii', 0, 2)).eql('hi');
    }));

    it("should handle \\' hex excape", co(function* () {
      const result = yield process(["\\'a0\\'FF"]);
      expect(result).to.be.an('array').of.length(2);

      const buf1 = new Buffer([160]);
      const buf2 = new Buffer([255]);
      expect(result[0]).to.eql({type: 'SYMBOL', word: "'", data: buf1, nibbles: 2});
      expect(result[1]).to.eql({type: 'SYMBOL', word: "'", data: buf2, nibbles: 2});
    }));
  });
});
