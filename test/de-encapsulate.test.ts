// Node
import * as fs from 'fs';
import * as iconvLite from 'iconv-lite';

// NPM
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
const expect = chai.expect;

// Module
import { Tokenize } from '../src/tokenize';
import { DeEncapsulate, Options } from '../src/de-encapsulate';
import { streamFlow } from '../src/stream-flow';

// Test
import { Readable } from 'stream';

describe('DeEncapsulate', () => {
    async function process(inputs: (string | Buffer) | (string | Buffer)[], options?: Options) {
        const encodings: Set<string> = new Set();
        const warnings: string[] = [];

        inputs = Array.isArray(inputs) ? inputs : [inputs];

        const options2: Options = {
            decode: (str, enc) => {
                encodings.add(enc);
                return iconvLite.decode(str, enc)
            },
            warn: str => warnings.push(str),
            ...options
        };

        const streamIn = new Readable();
        streamIn._read = () => { };
        const p = streamFlow(
            streamIn,
            new Tokenize(),
            new DeEncapsulate(options2)
        );

        // Do in a timeout just to simulate more async-ness
        setTimeout(() => {
            for (const input of inputs) {
                streamIn.push(input);
            }
            streamIn.push(null);
        }, 1)

        const results = await p;
        return {
            text: results.join(''),
            warnings: warnings,
            encodings: [...encodings]
        };
    };

    describe('detection', () => {
        it(`should throw an error if input doesn't start with "{\\rtf1"`, async () => {
            await expect(process(''))
                .to.be.rejectedWith('File should start with');

            await expect(process('{'))
                .to.be.rejectedWith('File should start with');

            await expect(process('\\word\\WoRd'))
                .to.be.rejectedWith('File should start with');

            await expect(process('{\\word\\WoRd}'))
                .to.be.rejectedWith('File should start with');

            await expect(process('{\\rtf2\\WoRd}'))
                .to.be.rejectedWith('File should start with');
        });

        it('should throw an error if \\fromhtml1 not in first 10 tokens (and in HTML-only mode)', async () => {
            await expect(process('{\\rtf1}'))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\bin10 \\fromhtml1}'))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\t3}'))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\t10\\fromhtml1}'))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtm\\t10}'))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9}'))
                .to.be.rejectedWith('Not encapsulated HTML file');
        });

        it('should throw an error if any tokens besides "{" or control words are within first 10', async () => {
            await expect(process('{\\rtf1\\t3\\t4 some text\\fromhtml1'))
                .to.be.rejectedWith('Not encapsulated HTML file');
        });

        it('should not throw an error if \\fromhtml1 in first 10 tokens', async () => {
            await process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\fromhtml1}');
            await process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtml1\\t10}');
        });

        it('should not throw an error if \\fromhtml1 in first 10 tokens but in text-only mode', async () => {
            await expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\fromhtml1}', { mode: 'text' }))
                .to.be.rejectedWith('Not encapsulated text file');
            await expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtml1\\t10}', { mode: 'text' }))
                .to.be.rejectedWith('Not encapsulated text file');
        });

        it('should ignore any content after closing bracket', async () => {
            const input = '{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\fromhtml1 hello}hello';
            const result = await process(input);
            expect(result.text).to.eql('hello');
        });
    });

    describe('html text output', () => {
        describe('with Unicode escapes', () => {
            it('should properly decode characters (with default Node-native decoder)', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\uc0{{{{{{\\u104\\u105\\u8226}}}}}}}';
                const result = await process(input, { decode: undefined });

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal([]);

                expect(result.text).to.eql('hi•');
            });

            it('should handle cp20127 (us-ascii) without the decoder', async () => {
                const input = `{\\rtf1\\ansi\\ansicpg65001\\fromhtml1{{{{{{hello}}}}}}}`;
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.be.an('array').of.length(0);

                expect(result.text).to.eql(`hello`);
            });

            it('should handle cp65001 (UTF-8) without the decoder', async () => {
                const input = `{\\rtf1\\ansi\\ansicpg65001\\fromhtml1{{{{{{Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n}}}}}}}`;
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.be.an('array').of.length(0);

                expect(result.text).to.eql(`Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀`);
            });

            it('should properly decode characters (with iconv-lite)', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•');
            });

            it('should prefix output string with "html:" if desired', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226}}}}}}}';
                const result = await process(input, { mode: 'either', prefix: true });

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('html:hi•');
            });

            it('should skip 1 character after by default', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226hello}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•ello');
            });

            it('should not count following space as character to skip', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226 hello}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•ello');
            });

            it('should skip based on current \\uc value', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\uc3{{{{{hi\\u8226 hello}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•lo');
            });

            it('should reset \\uc value when leaving group', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{\\uc5}hi\\u8226 hello}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•ello');
            });

            it('should skip whole and partial string tokens', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\uc4{{{{{hi\\u8226 he\\\\llo}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•lo');
            });

            it('should count control words, control symbols, and binary as 1 skippable', async () => {
                const input = "{\\rtf1\\ansi\\fromhtml1\\uc5{{{{{hi\\u8226\\u8226\\'A0\\bin3 {}hello}}}}}}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•lo');
            });

            it('should stop skipping when encountering { or }', async () => {
                const input = "{\\rtf1\\ansi\\fromhtml1\\uc15{{{{{hi\\u8226\\hel{}lo}}}}}}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•lo');
            });

            it('should properly handle negative Unicode values', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag hi\\u-4064}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi' + String.fromCodePoint(0xF020));
            });
        });

        describe('from inside htmltag destinations', () => {
            it('should handle control symbol octet escapes', async () => {
                const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag <sometag\\{/>}}';
                const result = await process(rtf);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('<sometag{/>');
            });

            it('should handle control word Unicode escapes', async () => {
                const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag \\lquote hi\\bullet}}';
                const result = await process(rtf);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('‘hi•');
            });

            it('should ignore other control words', async () => {
                const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag\\htmlrtf <sometag/>\\htmlrtf0}}';
                const result = await process(rtf);

                expect(result.warnings).to.deep.equal([
                    'htmlrtf control word inside htmltag',
                    'htmlrtf control word inside htmltag',
                ]);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('<sometag/>');
            });

            it('should interpret hex escapes in specified default code page', async () => {
                // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
                const input = "{\\rtf1\\ansi\\ansicpg1253\\fromhtml1\\t6\\t7{\\*\\htmltag\\'f0}}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1253']);

                expect(result.text).to.eql('π');
            });

            it('should interpret hex escapes in Windows-1252 codepage if no default given', async () => {
                const input = "{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag\\'95}}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('•');
            });

            it("should interpret any 8-bit values in default code page (shouldn't happen)", async () => {
                const input = ["{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag hi", Buffer.from([0x95]), "}}"];
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hi•');
            });

            it("should ignore control words inside content html", async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag {\\htmlrtf hi}}hi}';
                const result = await process(input);

                expect(result.warnings).to.deep.equal([
                    'htmlrtf control word inside htmltag'
                ]);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('hihi');
            });

            // Form https://github.com/mazira/rtf-stream-parser/issues/1
            it('should extract href inner text properly', async () => {
                const input = [
                    `{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7`,
                    `{\\*\\htmltag84 <a href="mailto:address@emailhost.net">}`,
                    `\\htmlrtf {\\field{\\*\\fldinst{HYPERLINK "mailto:address@emailhost.net"}}{\\fldrslt\\cf1\\ul \\htmlrtf0 address@emailhost.net\\htmlrtf }\\htmlrtf0 \\htmlrtf }\\htmlrtf0`,
                    `{\\*\\htmltag92 </a>}`,
                    `}`];
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('<a href="mailto:address@emailhost.net">address@emailhost.net</a>');
            });
        });

        describe('from outside htmltag destinations', () => {
            it('should handle control symbol octet escapes', async () => {
                const input = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{{{{{text\\}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('text}');
            });

            it('should handle control word Unicode escapes', async () => {
                const input = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{{{{{text\\lquote\\bullet}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('text‘•');
            });

            it("should interpret hex escapes in current font's codepage", async () => {
                // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
                // Use "f0" before text
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{\\fonttbl{\\f0\\fcharset161}}\\f0\\'f0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1253']);

                expect(result.text).to.eql('π');
            });

            it('should use default font if no current font', async () => {
                // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
                // Use "deff0" instead of "f0"
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0\\fcharset161}}\\'f0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1253']);

                expect(result.text).to.eql('π');
            });

            it('should allow \\cpg to override \\fcharset', async () => {
                // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
                // Use "deff0" instead of "f0"
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0\\cpg1253\\fcharset255}}\\'f0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1253']);

                expect(result.text).to.eql('π');
            });

            it('should ignore text inside htmlrtf ignores', async () => {
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0}}\\htmlrtf hello\\htmlrtf0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.be.an('array').of.length(0);

                expect(result.text).to.eql('');
            });

            it('should track htmlrtf state in groups', async () => {
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0}}\\htmlrtf{\\htmlrtf0}hello\\htmlrtf0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.be.an('array').of.length(0);

                expect(result.text).to.eql('');
            });

            it('should track \\f changes inside htmlrtf ignores', async () => {
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f1\\cpg1253}}\\htmlrtf\\f1\\htmlrtf0\\'f0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1253']);

                expect(result.text).to.eql('π');
            });

            it('should buffer multiple text runs to decode at once', async () => {
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f1\\cpg936}}\\htmlrtf\\f1\\htmlrtf0\\'a5\\'c6\\'a5\\'e5}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp936']);

                expect(result.text).to.eql('テュ');
            });

            it('should ignore text from \\pntext group', async () => {
                const input = [
                    `{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t5\\t6\\t7`,
                    `{\\*\\htmltag64 <li>}`,
                    `\\htmlrtf {{\\*\\pn\\pnlvlblt\\pnf2\\pnindent360{\\pntxtb\\'b7}}\\htmlrtf0 \\li360 \\fi-360 {\\pntext *\\tab}Item 1`,
                    `{\\*\\htmltag244 <o:p>}`,
                    `{\\*\\htmltag252 </o:p>}`,
                    `\\htmlrtf\\par}\\htmlrtf0`,
                    `{\\*\\htmltag72 </li>}`,
                    `}`
                ];
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.deep.equal(['cp1252']);

                expect(result.text).to.eql('<li>Item 1<o:p></o:p></li>');
            });

            it('should ignore formatConverter destination', async () => {
                const input = [
                    '{\\rtf1\\ansi\\fbidis\\ansicpg936\\deff0\\fromhtml1{\\fonttbl}',
                    '{\\*\\generator Microsoft Exchange Server;}',
                    '{\\*\\formatConverter converted from html;}',
                    '}'
                ];
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.be.an('array').of.length(0);

                expect(result.text).to.eql('');
            });

            it('should ignore any optional destinations (even unknown ones)', async () => {
                const input = [
                    '{\\rtf1\\ansi\\fbidis\\ansicpg936\\deff0\\fromhtml1{\\fonttbl}',
                    '{\\*\\someNewGroup some stupid text;}',
                    '}'
                ];
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.encodings).to.be.an('array').of.length(0);

                expect(result.text).to.eql('');
            });
        });
    });

    describe('from text', () => {
        const input = `{\\rtf1\\ansi\\ansicpg1252\\fromtext \\fbidis \\deff0{\\fonttbl\r\n{\\f0\\fswiss\\fcharset0 Arial;}`
            + `\r\n{\\f1\\fmodern Courier New;}\r\n{\\f2\\fnil\\fcharset2 Symbol;}\r\n{\\f3\\fmodern\\fcharset0 Courier New;}}`
            + `\r\n{\\colortbl\\red0\\green0\\blue0;\\red0\\green0\\blue255;}\r\n\\uc1\\pard\\plain\\deftab360 \\f0\\fs20 `
            + `Plain text body: ! < > " ' \\'80 \\'9c \\'a4 \\'b4 \\'bc \\'bd \\u-10175 ?\\u-8434 ? \\u-10137 ?\\u-8808 ? `
            + `\\u-10179 ?\\u-8704 ?\\par\r\n}`

        it('should handle Unicode surrogate pairs with the default \\uc skip of 1', async () => {
            const input = "{\\rtf1\\ansi\\ansicpg1252\\fromtext{{{{{{\\u-10179 ?\\u-8704 ?}}}}}}}";
            const result = await process(input, { mode: 'text' });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.encodings).to.be.an('array').of.length(0);

            expect(result.text).to.eql('😀');
        });

        it('should properly de-encapsulate in "text" mode', async () => {
            const result = await process(input, { mode: 'text' });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.encodings).to.deep.equal(['cp1252']);

            expect(result.text).to.eql(`Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n`);
        });

        it('should properly de-encapsulate in "either" mode', async () => {
            const result = await process(input, { mode: 'either' });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.encodings).to.deep.equal(['cp1252']);

            expect(result.text).to.eql(`Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n`);
        });

        it('should properly prefix with "text:" if requested', async () => {
            const result = await process(input, { mode: 'either', prefix: true });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.encodings).to.deep.equal(['cp1252']);

            expect(result.text).to.eql(`text:Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n`);
        });

        it('should handle \\par and \\line both as CRLF', async () => {
            const input = "{\\rtf1\\ansi\\ansicpg1252\\fromtext{{{{{{\\par\\line\\tab}}}}}}}";
            const result = await process(input, { mode: 'text' });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.encodings).to.be.an('array').of.length(0);

            expect(result.text).to.eql('\r\n\r\n\t');
        });
    });

    it('should properly decapsulate the spec example', async () => {
        const options: Options = {
            decode: iconvLite.decode,
            mode: 'html',
            warn: () => { }
        };
        const sin = fs.createReadStream('test/examples/encapsulated.rtf');
        const result = await streamFlow(sin, new Tokenize(), new DeEncapsulate(options));
        const html = result.join('');
        const html2 = fs.readFileSync('test/examples/encapsulated.html', 'utf8');
        expect(html).to.eql(html2);
    });

    it('should properly decapsulate the JIS example', async () => {
        const options: Options = {
            decode: iconvLite.decode,
            mode: 'text',
            warn: () => { }
        };
        const sin = fs.createReadStream('test/examples/jis-test.rtf');
        const result = await streamFlow(sin, new Tokenize(), new DeEncapsulate(options));
        const text = result.join('');
        const text2 = fs.readFileSync('test/examples/jis-test.txt', 'utf8');
        expect(text).to.eql(text2);
    });
});
