'use strict';

// NPM
const co = require('bluebird').coroutine;
const expect = require('chai').expect;

// Module
const Tokenize = require('../lib/tokenize');
const utils = require('./utils');

describe('RTFParser', function () {
  function process(inputs) {
    return utils.streamFlow([new Tokenize()], inputs);
  }

  describe('tokenization', function () {
    it('should allow uppercase and lowercase control words', co(function* () {
      const result = yield process(['\\word\\WoRd']);
      expect(result).to.be.an('array').of.length(2);
      expect(result[0]).to.eql({ type: 'CONTROL', word: 'word' });
      expect(result[1]).to.eql({ type: 'CONTROL', word: 'WoRd' });
    }));

    it('should find control words across chunks', co(function* () {
      const result = yield process(['\\wo', 'rd\\WoRd']);
      expect(result).to.be.an('array').of.length(2);
      expect(result[0]).to.eql({ type: 'CONTROL', word: 'word' });
      expect(result[1]).to.eql({ type: 'CONTROL', word: 'WoRd' });
    }));

    it('should eat the optional space after control words', co(function* () {
      const result = yield process(['\\word \\WoRd  ']);
      expect(result).to.be.an('array').of.length(3);
      expect(result[0]).to.eql({type: 'CONTROL', word: 'word'});
      expect(result[1]).to.eql({type: 'CONTROL', word: 'WoRd'});
      expect(result[2]).to.eql({type: 'TEXT', data: new Buffer(' ')});
    }));

    it('should not eat spaces after control sysmbols', co(function* () {
      const result = yield process(['\\{ \\}  ']);
      expect(result).to.be.an('array').of.length(4);
      expect(result[0]).to.eql({type: 'CONTROL', word: '{'});
      expect(result[1]).to.eql({type: 'TEXT', data: new Buffer(' ')});
      expect(result[2]).to.eql({type: 'CONTROL', word: '}'});
      expect(result[3]).to.eql({type: 'TEXT', data: new Buffer('  ')});
    }));

    it('should allow control word numerical param', co(function* () {
      const result = yield process(['\\word001\\WoRd123']);
      expect(result).to.be.an('array').of.length(2);
      expect(result[0]).to.eql({type: 'CONTROL', word: 'word', param: 1});
      expect(result[1]).to.eql({type: 'CONTROL', word: 'WoRd', param: 123});
    }));

    it('should allow negative control word numerical param', co(function* () {
      const result = yield process(['\\word-001\\WoRd-123']);
      expect(result).to.be.an('array').of.length(2);
      expect(result[0]).to.eql({type: 'CONTROL', word: 'word', param: -1});
      expect(result[1]).to.eql({type: 'CONTROL', word: 'WoRd', param: -123});
    }));

    it('should return control symbols with "word" property', co(function* () {
      const result = yield process(['\\word0 hi\\', '{\\\\\\', '}']);
      expect(result).to.be.an('array').of.length(5);
      expect(result[0]).to.eql({type: 'CONTROL', word: 'word', param: 0});
      expect(result[1]).to.eql({type: 'TEXT', data: new Buffer('hi')});
      expect(result[2]).to.eql({type: 'CONTROL', word: '{'});
      expect(result[3]).to.eql({type: 'CONTROL', word: '\\'});
      expect(result[4]).to.eql({type: 'CONTROL', word: '}'});
    }));

    it('should not detect control words in binary data', co(function* () {
      const result = yield process(['\\bin', '4 \\hi2\\hi3']);
      expect(result).to.be.an('array').of.length(2);

      const buf = new Buffer('\\hi2');
      expect(result[0]).to.eql({type: 'CONTROL', word: 'bin', param: 4, data: buf});
      expect(result[1]).to.eql({type: 'CONTROL', word: 'hi', param: 3});
    }));

    it('should handle \\bin control word without positive param', co(function* () {
      const result = yield process(['\\bin ', '\\bin0 \\bin-10 ']);
      expect(result).to.be.an('array').of.length(3);

      expect(result[0]).to.eql({type: 'CONTROL', word: 'bin'});
      expect(result[1]).to.eql({type: 'CONTROL', word: 'bin', param: 0});
      expect(result[2]).to.eql({type: 'CONTROL', word: 'bin', param: -10});
    }));

    it('should handle \\bin control with early EOF', co(function* () {
      const result = yield process(['\\bin10 hi']);
      expect(result).to.be.an('array').of.length(1);

      expect(result[0]).to.eql({
        type: 'CONTROL', word: 'bin', param: 10, data: new Buffer('hi')
      });
    }));

    it('should handle optional \\*\destination control symbols', co(function* () {
      const result = yield process(['{\\*\\destination}']);
      expect(result).to.be.an('array').of.length(4);

      expect(result[0]).to.eql({type: 'GROUP_START'});
      expect(result[1]).to.eql({type: 'CONTROL', word: '*'});
      expect(result[2]).to.eql({type: 'CONTROL', word: 'destination'});
      expect(result[3]).to.eql({type: 'GROUP_END'});
    }));

    it("should handle \\' hex excape", co(function* () {
      const result = yield process(["\\'a0\\'FF"]);
      expect(result).to.be.an('array').of.length(2);

      expect(result[0]).to.eql({type: 'CONTROL', word: "'", data: new Buffer([160])});
      expect(result[1]).to.eql({type: 'CONTROL', word: "'", data: new Buffer([255])});
    }));

    it("should handle \\' hex excape early termination", co(function* () {
      const result = yield process(["\\'F"]);
      expect(result).to.be.an('array').of.length(1);
      expect(result[0]).to.eql({type: 'CONTROL', word: "'", data: new Buffer(0)});

      const result2 = yield process(["\\'"]);
      expect(result2).to.be.an('array').of.length(1);
      expect(result2[0]).to.eql({type: 'CONTROL', word: "'", data: new Buffer(0)});
    }));
  });
});
