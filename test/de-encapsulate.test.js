'use strict';

// Node
const fs = require('fs');

// NPM
const Promise = require('bluebird');
const co = require('bluebird').coroutine;
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
chai.use(chaiAsPromised);


// Module
const Tokenize = require('../').Tokenize;
const DeEncapsulate = require('../').DeEncapsulate;
const utils = require('./utils');

describe('De-encapsulator', function () {
  const process = co(function* (input, mode, prefix) {
    input = Array.isArray(input) ? input : [input];
    const result = yield utils.streamFlow([new Tokenize(), new DeEncapsulate(mode, prefix)], input);
    return result.join('');
  });

  describe('detection', function () {
    it('should throw an error if input doesn\'t start with "{\\rtf1"', co(function* () {
      yield expect(process(''))
        .to.be.rejectedWith('File should start with');

      yield expect(process('{'))
        .to.be.rejectedWith('File should start with');

      yield expect(process('\\word\\WoRd'))
        .to.be.rejectedWith('File should start with');

      yield expect(process('{\\word\\WoRd}'))
        .to.be.rejectedWith('File should start with');

      yield expect(process('{\\rtf2\\WoRd}'))
        .to.be.rejectedWith('File should start with');
    }));

    it('should throw an error if \\fromhtml1 not in first 10 tokens (and in HTML-only mode)', co(function* () {
      yield expect(process('{\\rtf1}'))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process('{\\rtf1\\bin10 \\fromhtml1}'))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process('{\\rtf1\\t3}'))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\t10\\fromhtml1}'))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtm\\t10}'))
        .to.be.rejectedWith('Not encapsulated HTML file');

      yield expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9}'))
        .to.be.rejectedWith('Not encapsulated HTML file');
    }));

    it('should throw an error if any tokens besides "{" or control words are within first 10', co(function* () {
      yield expect(process('{\\rtf1\\t3\\t4 some text\\fromhtml1'))
        .to.be.rejectedWith('Not encapsulated HTML file');
    }));

    it('should not throw an error if \\fromhtml1 in first 10 tokens', co(function* () {
      yield process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\fromhtml1}');
      yield process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtml1\\t10}');
    }));

    it('should not throw an error if \\fromhtml1 in first 10 tokens but in text-only mode', co(function* () {
      yield expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\fromhtml1}', 'text'))
        .to.be.rejectedWith('Not encapsulated text file');
      yield expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtml1\\t10}', 'text'))
        .to.be.rejectedWith('Not encapsulated text file');
    }));

    it('should ignore any content after closing bracket', co(function* () {
      const input = '{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\fromhtml1 hello}hello';
      const html = yield process(input);
      expect(html).to.eql('hello');
    }));
  });

  describe('html text output', function () {
    describe('with Unicode escapes', function () {
      it('should properly decode characters', co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226}}}}}}}';
        const html = yield process(input);
        expect(html).to.eql('hi•');
      }));

      it('should prefix output string with "html:" if desired', co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226}}}}}}}';
        const html = yield process(input, 'either', true);
        expect(html).to.eql('html:hi•');
      }))

      it('should skip 1 character after by default', co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226hello}}}}}}}';
        const html = yield process(input);
        expect(html).to.eql('hi•ello');
      }));

      it('should not count following space as character to skip', co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226 hello}}}}}}}';
        const html = yield process(input);
        expect(html).to.eql('hi•ello');
      }));

      it('should skip based on current \\uc value', co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1\\uc3{{{{{hi\\u8226 hello}}}}}}';
        const html = yield process(input);
        expect(html).to.eql('hi•lo');
      }));

      it('should reset \\uc value when leaving group', co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{\\uc5}hi\\u8226 hello}}}}}}';
        const html = yield process(input);
        expect(html).to.eql('hi•ello');
      }));

      it('should skip whole and partial string tokens', co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1\\uc4{{{{{hi\\u8226 he\\\\llo}}}}}}';
        const html = yield process(input);
        expect(html).to.eql('hi•lo');
      }));

      it('should count control words, control symbols, and binary as 1 skippable', co(function* () {
        const input = "{\\rtf1\\ansi\\fromhtml1\\uc5{{{{{hi\\u8226\\u8226\\'A0\\bin3 {}hello}}}}}}";
        const html = yield process(input);
        expect(html).to.eql('hi•lo');
      }));

      it('should stop skipping when encountering { or }', co(function* () {
        const input = "{\\rtf1\\ansi\\fromhtml1\\uc15{{{{{hi\\u8226\\hel{}lo}}}}}}";
        const html = yield process(input);
        expect(html).to.eql('hi•lo');
      }));

      it('should properly handle negative Unicode values', co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag hi\\u-4064}}';
        const html = yield process(input);
        expect(html).to.eql('hi' + String.fromCodePoint(0xF020));
      }));
    });

    describe('from inside htmltag destinations', function () {
      it('should handle control symbol octet escapes', co(function* () {
        const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag <sometag\\{/>}}';
        const html = yield process(rtf);
        expect(html).to.eql('<sometag{/>');
      }));

      it('should handle control word Unicode escapes', co(function* () {
        const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag \\lquote hi\\bullet}}';
        const html = yield process(rtf);
        expect(html).to.eql('‘hi•');
      }));

      it('should ignore other control words', co(function* () {
        const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag\\htmlrtf <sometag/>\\htmlrtf0}}';
        const html = yield process(rtf);
        expect(html).to.eql('<sometag/>');
      }));

      it('should interpret hex escapes in specified default code page', co(function* () {
        // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
        const input = "{\\rtf1\\ansi\\ansicpg1253\\fromhtml1\\t6\\t7{\\*\\htmltag\\'f0}}";
        const html = yield process(input);
        expect(html).to.eql('π');
      }));

      it('should interpret hex escapes in Windows-1252 codepage if no default given', co(function* () {
        const input = "{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag\\'95}}";
        const html = yield process(input);
        expect(html).to.eql('•');
      }));

      it("should interpret any 8-bit values in default code page (shouldn't happen)", co(function* () {
        const input = ["{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag hi", new Buffer([0x95]), "}}"];
        const html = yield process(input);
        expect(html).to.eql('hi•');
      }));

      it("should ignore control words inside content html", co(function* () {
        const input = '{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag {\\htmlrtf hi}}hi}';
        const html = yield process(input);
        expect(html).to.eql('hihi');
      }))

      // Form https://github.com/mazira/rtf-stream-parser/issues/1
      it('should extract href inner text properly', co(function* () {
        const input = [
          '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7',
          '{\\*\\htmltag84 <a href="mailto:address@emailhost.net">}',
          '\\htmlrtf {\\field{\\*\fldinst{HYPERLINK "mailto:address@emailhost.net"}}{\\fldrslt\\cf1\\ul \\htmlrtf0 address@emailhost.net\\htmlrtf }\\htmlrtf0 \\htmlrtf }\\htmlrtf0',
          '{\\*\\htmltag92 </a>}',
          '}'];
        const html = yield process(input);
        expect(html).to.eql('<a href="mailto:address@emailhost.net">address@emailhost.net</a>');
      }))
    });

    describe('from outside htmltag destinations', function () {
      it('should handle control symbol octet escapes', co(function* () {
        const input = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{{{{{text\\}}}}}}}';
        const html = yield process(input);
        expect(html).to.eql('text}');
      }));

      it('should handle control word Unicode escapes', co(function* () {
        const input = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{{{{{text\\lquote\\bullet}}}}}}';
        const html = yield process(input);
        expect(html).to.eql('text‘•');
      }));

      it("should interpret hex escapes in current font's codepage", co(function* () {
        // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
        // Use "f0" before text
        const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{\\fonttbl{\\f0\\fcharset161}}\\f0\\'f0}";
        const html = yield process(input);
        expect(html).to.eql('π');
      }));

      it('should use default font if no current font', co(function* () {
        // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
        // Use "deff0" instead of "f0"
        const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0\\fcharset161}}\\'f0}";
        const html = yield process(input);
        expect(html).to.eql('π');
      }));

      it('should allow \\cpg to override \\fcharset', co(function* () {
        // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
        // Use "deff0" instead of "f0"
        const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0\\cpg1253\\fcharset255}}\\'f0}";
        const html = yield process(input);
        expect(html).to.eql('π');
      }));

      it('should ignore text inside htmlrtf ignores', co(function* () {
        const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0}}\\htmlrtf hello\\htmlrtf0}";
        const html = yield process(input);
        expect(html).to.eql('');
      }));

      it('should track htmlrtf state in groups', co(function* () {
        const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0}}\\htmlrtf{\\htmlrtf0}hello\\htmlrtf0}";
        const html = yield process(input);
        expect(html).to.eql('');
      }));

      it('should track \\f changes inside htmlrtf ignores', co(function* () {
        const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f1\\cpg1253}}\\htmlrtf\\f1\\htmlrtf0\\'f0}";
        const html = yield process(input);
        expect(html).to.eql('π');
      }));

      it('should buffer multiple text runs to decode at once', co(function* () {
        const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f1\\cpg936}}\\htmlrtf\\f1\\htmlrtf0\\'a5\\'c6\\'a5\\'e5}";
        const html = yield process(input);
        expect(html).to.eql('テュ');
      }));

      it('should ignore text from \\pntext group', co(function* () {
        const input = [
          '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t5\\t6\\t7',
          '{\\*\\htmltag64 <li>}',
          '\\htmlrtf {{\\*\\pn\\pnlvlblt\\pnf2\\pnindent360{\\pntxtb\'b7}}\\htmlrtf0 \\li360 \\fi-360 {\\pntext *\\tab}Item 1',
          '{\\*\\htmltag244 <o:p>}',
          '{\\*\\htmltag252 </o:p>}',
          '\\htmlrtf\\par}\\htmlrtf0',
          '{\\*\\htmltag72 </li>}',
          '}'
        ];
        const html = yield process(input);
        expect(html).to.eql('<li>Item 1<o:p></o:p></li>');
      }));

      it('should ignore formatConverter destination', co(function* () {
        const input = [
          '{\\rtf1\\ansi\\fbidis\\ansicpg936\\deff0\\fromhtml1{\\fonttbl}',
          '{\\*\\generator Microsoft Exchange Server;}',
          '{\\*\\formatConverter converted from html;}',
          '}'
        ];
        const html = yield process(input);
        expect(html).to.eql('');
      }));

      it('should ignore any optional destinations (even unknown ones)', co(function* () {
        const input = [
          '{\\rtf1\\ansi\\fbidis\\ansicpg936\\deff0\\fromhtml1{\\fonttbl}',
          '{\\*\\someNewGroup some stupid text;}',
          '}'
        ];
        const html = yield process(input);
        expect(html).to.eql('');
      }));
    });
  });

  describe('from text', () => {
    const input = "{\\rtf1\\ansi\\ansicpg1252\\fromtext \\fbidis \\deff0{\\fonttbl\r\n{\\f0\\fswiss\\fcharset0 Arial;}"
      + "\r\n{\\f1\\fmodern Courier New;}\r\n{\\f2\\fnil\\fcharset2 Symbol;}\r\n{\\f3\\fmodern\\fcharset0 Courier New;}}"
      + "\r\n{\\colortbl\\red0\\green0\\blue0;\\red0\\green0\\blue255;}\r\n\\uc1\\pard\\plain\\deftab360 \\f0\\fs20 "
      + "Plain text body: ! < > \" ' \\'80 \\'9c \\'a4 \\'b4 \\'bc \\'bd \\u-10175 ?\\u-8434 ? \\u-10137 ?\\u-8808 ? "
      + "\\u-10179 ?\\u-8704 ?\\par\r\n}"

    it('should handle Unicode surrogate pairs with the default \\uc skip of 1', co(function* () {
      const input = "{\\rtf1\\ansi\\ansicpg1252\\fromtext{{{{{{\\u-10179 ?\\u-8704 ?}}}}}}}";
      const text = yield process(input, 'text');
      expect(text).to.eql('😀');
    }));

    it('should properly de-encapsulate in "text" mode', co(function* () {
      const text = yield process(input, 'text');
      expect(text).to.eql('Plain text body: ! < > " \' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n');
    }));

    it('should properly de-encapsulate in "either" mode', co(function* () {
      const text = yield process(input, 'either');
      expect(text).to.eql('Plain text body: ! < > " \' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n');
    }));

    it('should properly prefix with "text:" if requested', co(function* () {
      const text = yield process(input, 'either', true);
      expect(text).to.eql('text:Plain text body: ! < > " \' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n');
    }));
  });

  it('should properly decapsulate the spec example', co(function* () {
    const sin = fs.createReadStream(__dirname + '/examples/encapsulated.rtf');
    const result = yield utils.streamFlow([sin, new Tokenize(), new DeEncapsulate()]);
    const html = result.join('');
    const html2 = fs.readFileSync(__dirname + '/examples/encapsulated.html', 'utf8');
    expect(html).to.eql(html2);
  }));

  it('should properly decapsulate the JIS example', co(function* () {
    const sin = fs.createReadStream(__dirname + '/examples/jis-test.rtf');
    const result = yield utils.streamFlow([sin, new Tokenize(), new DeEncapsulate('text')]);
    const text = result.join('');
    const text2 = fs.readFileSync(__dirname + '/examples/jis-test.txt', 'utf8');
    expect(text.trim()).to.eql(text2.trim().replace(/\n/g, '\r\n'));
  }));
});
