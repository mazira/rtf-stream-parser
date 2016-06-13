'use strict';

// Node
const fs = require('fs');

// NPM
const Promise = require('bluebird');
const co = require('bluebird').coroutine;
const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const expect = require('chai').expect;
chai.use(chaiAsPromised);


// Module
const Tokenizer = require('../lib/tokenizer');
const DeEncapsulator = require('../lib/de-encapsulator');
const utils = require('./utils');

describe('De-encapsulator', function () {
  const process = function (inputs) {
    return utils.streamFlow([new Tokenizer(), new DeEncapsulator()], inputs);
  }

  describe('detection', function () {
    it('should throw an error if input doesn\'t start with "{\\rtf1"', co(function* () {
      yield expect(process(['']))
        .to.be.rejectedWith('File should start with');

      yield expect(process(['{']))
        .to.be.rejectedWith('File should start with');

      yield expect(process(['\\word\\WoRd']))
        .to.be.rejectedWith('File should start with');

      yield expect(process(['{\\word\\WoRd}']))
        .to.be.rejectedWith('File should start with');

      yield expect(process(['{\\rtf2\\WoRd}']))
        .to.be.rejectedWith('File should start with');
    }));

    it('should throw an error if \\fromhtml1 not in first 10 tokens', co(function* () {
      yield expect(process(['{\\rtf1']))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process(['{\\rtf1\\bin10 \\fromhtml1}']))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process(['{\\rtf1\\t3}']))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process(['{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\t10\\fromhtml1}']))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process(['{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtm\\t10}']))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process(['{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9}']))
        .to.be.rejectedWith('Not encapsulated HTML file');
    }));

    it('should throw an error if any tokens besides "{" or control words are within first 10', co(function* () {
      yield expect(process(['{\\rtf1\\t3\\t4 some text\\fromhtml1']))
        .to.be.rejectedWith('Not encapsulated HTML file');
    }));

    it('should not throw an error if \\fromhtml1 in first 10 tokens', co(function* () {
      yield process(['{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\fromhtml1}']);
      yield process(['{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtml1\\t10']);
    }));
  });

  describe('text output', function () {
    describe('from htmltag destination', function () {
      it('should handle control symbol octet escapes', co(function* () {
        const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag243 <sometag\\{/>}}';
        const result = yield process([rtf]);
        const html = result.join('');
        expect(html).to.eql('<sometag{/>');
      }));

      it('should interpret hex escapes in specified default code page', co(function* () {
        // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
        const input = ["{\\rtf1\\ansi\\ansicpg1253\\fromhtml1\\t6\\t7{\\*\\htmltag243 \\'f0}}"];
        const result = yield process(input);
        const html = result.join('');
        expect(html).to.eql('π');
      }));

      it('should interpret hex escapes in Windows-1252 codepage if no default given', co(function* () {
        // The bullet point is 0x95 (149) in Windows-1252, but 0x2022 in Unicode
        const input = ["{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag243 \\'95}}"];
        const result = yield process(input);
        const html = result.join('');
        expect(html).to.eql('•');
      }));

      it("should interpret any 8-bit values in default code page (shouldn't happen)", co(function* () {
        // The bullet point is 0x95 (149) in Windows-1252, but 0x2022 in Unicode
        const input = ["{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag243 hi", new Buffer([0x95]) , "}}"];
        const result = yield process(input);
        const html = result.join('');
        expect(html).to.eql('hi•');
      }));
    });
  });

  it('should properly decapsulate the spec example', co(function* () {
    const sin = fs.createReadStream(__dirname + '/examples/encapsulated.rtf');
    const result = yield utils.streamFlow([sin, new Tokenizer(), new DeEncapsulator()]);
    const html = result.join('');
    const html2 = fs.readFileSync(__dirname + '/examples/encapsulated.html', 'utf8');
    expect(html).to.eql(html2);
  }));
});
