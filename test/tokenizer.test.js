'use strict';

// NPM
const expect = require('chai').expect;

// Module
const Tokenizer = require('../lib/tokenizer');

describe('RTFParser', function () {
  function streamChunks(stream, inputs) {
    for (let i = 0; i < inputs.length; i++)
      stream.write(inputs[i]);

    stream.end();

    const output = [];
    let token;
    while (token = stream.read())
      output.push(token);

    return output;
  }

  describe('tokenization', function () {
    it('should allow uppercase and lowercase control words', function () {
      const output = streamChunks(new Tokenizer(), ['\\word\\WoRd']);
      expect(output).to.be.an('array').of.length(2);
      expect(output[0]).to.eql({type: 'WORD', value: 'word'});
      expect(output[1]).to.eql({type: 'WORD', value: 'WoRd'});
    });

    it('should find control words across chunks', function () {
      const output = streamChunks(new Tokenizer(), ['\\wo', 'rd\\WoRd']);
      expect(output).to.be.an('array').of.length(2);
      expect(output[0]).to.eql({type: 'WORD', value: 'word'});
      expect(output[1]).to.eql({type: 'WORD', value: 'WoRd'});
    });

    it('should eat the optional space after control words', function () {
      const output = streamChunks(new Tokenizer(), ['\\word \\WoRd  ']);
      expect(output).to.be.an('array').of.length(3);
      expect(output[0]).to.eql({type: 'WORD', value: 'word'});
      expect(output[1]).to.eql({type: 'WORD', value: 'WoRd'});
      expect(output[2]).to.eql({type: 'TEXT', value: ' '});
    });

    it('should allow control word numerical arguments', function () {
      const output = streamChunks(new Tokenizer(), ['\\word001\\WoRd123']);
      expect(output).to.be.an('array').of.length(2);
      expect(output[0]).to.eql({type: 'WORD', value: 'word', arg: 1});
      expect(output[1]).to.eql({type: 'WORD', value: 'WoRd', arg: 123});
    });

    it('should allow negative control word numerical arguments', function () {
      const output = streamChunks(new Tokenizer(), ['\\word-001\\WoRd-123']);
      expect(output).to.be.an('array').of.length(2);
      expect(output[0]).to.eql({type: 'WORD', value: 'word', arg: -1});
      expect(output[1]).to.eql({type: 'WORD', value: 'WoRd', arg: -123});
    });

    it('should return basic control symbol escapes as chars', function () {
      const output = streamChunks(new Tokenizer(), ['\\word0 hi\\', '{\\\\\\', '}']);
      expect(output).to.be.an('array').of.length(5);
      expect(output[0]).to.eql({type: 'WORD', value: 'word', arg: 0});
      expect(output[1]).to.eql({type: 'TEXT', value: 'hi'});
      expect(output[2]).to.eql({type: 'TEXT', value: '{'});
      expect(output[3]).to.eql({type: 'TEXT', value: '\\'});
      expect(output[4]).to.eql({type: 'TEXT', value: '}'});
    });

    it('should return escaped control symbol \\n, \\r, \\t as text', function () {
      const output = streamChunks(new Tokenizer(), ['\\word0 hi\\', '\r\\\n\\\t']);
      expect(output).to.be.an('array').of.length(5);
      expect(output[0]).to.eql({type: 'WORD', value: 'word', arg: 0});
      expect(output[1]).to.eql({type: 'TEXT', value: 'hi'});
      expect(output[2]).to.eql({type: 'TEXT', value: '\r'});
      expect(output[3]).to.eql({type: 'TEXT', value: '\n'});
      expect(output[4]).to.eql({type: 'TEXT', value: '\t'});
    });

    it('should properly skip binary data', function () {
      const output = streamChunks(new Tokenizer(), ['\\bin', '4 \\hi2\\hi3']);
      expect(output).to.be.an('array').of.length(2);

      const buf = new Buffer('\\hi2');
      expect(output[0]).to.eql({type: 'WORD', value: 'bin', arg: 4, data: buf, length: 4});
      expect(output[1]).to.eql({type: 'WORD', value: 'hi', arg: 3});
    });

    it('should handle \\bin control word without positive arg', function () {
      const output = streamChunks(new Tokenizer(), ['\\bin ', '\\bin0 \\bin-10 ']);
      expect(output).to.be.an('array').of.length(3);

      expect(output[0]).to.eql({type: 'WORD', value: 'bin'});
      expect(output[1]).to.eql({type: 'WORD', value: 'bin', arg: 0});
      expect(output[2]).to.eql({type: 'WORD', value: 'bin', arg: -10});
    });

    it('should handle \\bin control with early EOF', function () {
      const output = streamChunks(new Tokenizer(), ['\\bin10 hi']);
      expect(output).to.be.an('array').of.length(1);

      expect(output[0]).to.have.property('value', 'bin');
      expect(output[0]).to.have.property('arg', 10);
      expect(output[0]).to.have.property('length', 2);
      expect(output[0]).to.have.property('data');
      expect(output[0].data.toString('ascii', 0, 2)).eql('hi');
    });
  });
});
