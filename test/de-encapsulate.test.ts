import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as fs from 'fs';
import * as iconvLite from 'iconv-lite';
import { Readable } from 'stream';
import { DeEncapsulate, DeEncapsulateOptions } from '../src/de-encapsulate';
import { streamFlow } from '../src/stream-flow';
import { Tokenize } from '../src/tokenize';
import { isStr } from '../src/utils';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('DeEncapsulate', () => {
    async function process(inputs: (string | Buffer) | (string | Buffer)[], options?: Partial<DeEncapsulateOptions>) {
        const decodings: Set<string> = new Set();
        const encodings: Set<string> = new Set();
        const warnings: string[] = [];

        inputs = Array.isArray(inputs) ? inputs : [inputs];

        const options2: Partial<DeEncapsulateOptions> = {
            decode: (buf, enc) => {
                decodings.add(enc);
                return iconvLite.decode(buf, enc)
            },
            encode: (str, enc) => {
                encodings.add(enc);
                return iconvLite.encode(str, enc)
            },
            warn: str => warnings.push(str),
            ...options
        };

        const streamIn = new Readable();
        streamIn._read = () => { };

        const deEncapsulate = new DeEncapsulate(options2);
        const p = streamFlow<Buffer | string>(
            streamIn,
            new Tokenize(),
            deEncapsulate
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
            results: results,
            asText: results.map(r => isStr(r) ? r : r.toString('utf8')).join(''),
            asBuffer: Buffer.concat(results.map(r => isStr(r) ? Buffer.from(r, 'utf8') : r)),
            warnings: warnings,
            decodings: [...decodings],
            encodings: [...encodings],
            isHtml: deEncapsulate.isHtml,
            isText: deEncapsulate.isText,
            htmlCharset: deEncapsulate.originalHtmlCharset,
            defaultCodepage: deEncapsulate.defaultCodepage,
        };
    };

    describe('detection', () => {
        it(`should throw an error if input doesn't start with "{\\rtf[0,1]"`, async () => {
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

        it('should allow body "{\\rtf0" and "{\\rtf1" starts', async () => {
            {
                const input = '{\\rtf0\\ansi\\fromhtml1\\uc0{{{{{{hi}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi');
            }

            {
                const input = '{\\rtf1\\ansi\\fromhtml1\\uc0{{{{{{hi}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi');
            }
        });

        it('should throw an error if \\fromhtml1 not in first 10 tokens (and in HTML-only mode)', async () => {
            await expect(process('{\\rtf1}', { mode: 'html' }))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\bin10 \\fromhtml1}', { mode: 'html' }))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\t3}', { mode: 'html' }))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9\\t10\\fromhtml1}', { mode: 'html' }))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\fromhtm\\t10}', { mode: 'html' }))
                .to.be.rejectedWith('Not encapsulated HTML file');

            await expect(process('{\\rtf1\\t3\\t4\\t5\\t6\\t7\\t8\\t9}', { mode: 'html' }))
                .to.be.rejectedWith('Not encapsulated HTML file');
        });

        it('should throw an error if any tokens besides "{" or control words are within first 10', async () => {
            await expect(process('{\\rtf1\\t3\\t4 some text\\fromhtml1'))
                .to.be.rejectedWith('Not encapsulated HTML or text file');
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
            expect(result.asText).to.eql('hello');
        });
    });

    describe('html text output', () => {
        describe('with Unicode escapes', () => {
            it('should properly return characters (without using the default Node-native decoder)', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\uc0{{{{{{\\u104\\u105\\u8226}}}}}}}';
                const result = await process(input, { decode: undefined });

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal([]);

                expect(result.asText).to.eql('hi•');
            });

            it('should handle cp20127 (us-ascii) without the decoder', async () => {
                const input = `{\\rtf1\\ansi\\ansicpg65001\\fromhtml1{{{{{{hello}}}}}}}`;
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.be.an('array').of.length(0);

                expect(result.asText).to.eql(`hello`);
            });

            it('should handle cp65001 (UTF-8) without the decoder', async () => {
                const input = `{\\rtf1\\ansi\\ansicpg65001\\fromhtml1{{{{{{Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n}}}}}}}`;
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.be.an('array').of.length(0);

                expect(result.asText).to.eql(`Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀`);
            });

            it('should properly decode characters (with iconv-lite)', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•');
            });

            it('should prefix output string with "html:" if desired', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226}}}}}}}';
                const result = await process(input, { mode: 'either', prefix: true });

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('html:hi•');
            });

            it('should skip 1 character after by default', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226hello}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•ello');
            });

            it('should not count following space as character to skip', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{hi\\u8226 hello}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•ello');
            });

            it('should skip based on current \\uc value', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\uc3{{{{{hi\\u8226 hello}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•lo');
            });

            it('should reset \\uc value when leaving group', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1{{{{{{\\uc5}hi\\u8226 hello}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•ello');
            });

            it('should skip whole and partial string tokens', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\uc4{{{{{hi\\u8226 he\\\\llo}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•lo');
            });

            it('should count control words, control symbols, and binary as 1 skippable', async () => {
                const input = "{\\rtf1\\ansi\\fromhtml1\\uc5{{{{{hi\\u8226\\u8226\\'A0\\bin3 {}hello}}}}}}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•lo');
            });

            it('should stop skipping when encountering { or }', async () => {
                const input = "{\\rtf1\\ansi\\fromhtml1\\uc15{{{{{hi\\u8226\\hel{}lo}}}}}}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•lo');
            });

            it('should properly handle negative Unicode values', async () => {
                const input = '{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag hi\\u-4064}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi' + String.fromCodePoint(0xF020));
            });
        });

        describe('from inside htmltag destinations', () => {
            it('should handle control symbol octet escapes', async () => {
                const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag <sometag\\{/>}}';
                const result = await process(rtf);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('<sometag{/>');
            });

            it('should handle control word Unicode escapes', async () => {
                const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7{\\*\\htmltag \\lquote hi\\bullet}}';
                const result = await process(rtf);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('‘hi•');
            });

            it('should still suppress content with htmlrtf (spec is unclear about this... but this example seen in the wild)', async () => {
                const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7'
                    + '{\\*\\htmltag241 <!--[if gte mso 15]>&nbsp;\\htmlrtf .\\u32  \\htmlrtf0<![endif]-->}}';
                const result = await process(rtf);

                expect(result.warnings).to.deep.equal([]);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('<!--[if gte mso 15]>&nbsp;<![endif]-->');
            });

            it('should interpret hex escapes in specified default code page', async () => {
                // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
                const input = "{\\rtf1\\ansi\\ansicpg1253\\fromhtml1\\t6\\t7{\\*\\htmltag\\'f0}}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1253']);

                expect(result.asText).to.eql('π');
            });

            it('should interpret hex escapes in Windows-1252 codepage if no default given', async () => {
                const input = "{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag\\'95}}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('•');
            });

            it("should interpret any 8-bit values in default code page (shouldn't happen)", async () => {
                const input = ["{\\rtf1\\ansi\\fromhtml1\\t5\\t6\\t7{\\*\\htmltag hi", Buffer.from([0x95]), "}}"];
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('hi•');
            });

            // Form https://github.com/mazira/rtf-stream-parser/issues/1
            it('should extract href inner text properly', async () => {
                const input = [
                    `{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7`,
                    `{\\*\\htmltag84 <a href="mailto:address@emailhost.net">}`,
                    `\\htmlrtf {\\field{\\*\\fldinst{HYPERLINK "mailto:address@emailhost.net"}}`,
                    `{\\fldrslt\\cf1\\ul \\htmlrtf0 address@emailhost.net\\htmlrtf }\\htmlrtf0 \\htmlrtf }\\htmlrtf0`,
                    `{\\*\\htmltag92 </a>}`,
                    `}`];
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('<a href="mailto:address@emailhost.net">address@emailhost.net</a>');
            });
        });

        describe('from outside htmltag destinations', () => {
            it('should handle control symbol octet escapes', async () => {
                const input = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{{{{{text\\}}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('text}');
            });

            it('should handle control word Unicode escapes', async () => {
                const input = '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{{{{{text\\lquote\\bullet}}}}}}';
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('text‘•');
            });

            it("should interpret hex escapes in current font's codepage", async () => {
                // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
                // Use "f0" before text
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1{\\fonttbl{\\f0\\fcharset161}}\\f0\\'f0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1253']);

                expect(result.asText).to.eql('π');
            });

            it('should use default font if no current font', async () => {
                // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
                // Use "deff0" instead of "f0"
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0\\fcharset161}}\\'f0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1253']);

                expect(result.asText).to.eql('π');
            });

            it('should allow \\cpg to override \\fcharset', async () => {
                // Lowercase pi is 0xF0 (240) in Windows-1253, but 0x03C0 in Unicode
                // Use "deff0" instead of "f0"
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0\\cpg1253\\fcharset255}}\\'f0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1253']);

                expect(result.asText).to.eql('π');
            });

            it('should not warn when fcharset is set to codepage 20127 (technically incorrect but seen in wild)', async () => {
                const input = "{\\rtf1\\ansi\\fromhtml1\\deff0{\\fonttbl{\\f0\\fcharset20127}}\\'41}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal([]);

                expect(result.asText).to.eql('A');
            });

            it('should not warn when fcharset is set to codepage 1252 (technically incorrect but seen in wild)', async () => {
                const input = "{\\rtf1\\ansi\\fromhtml1\\deff0{\\fonttbl{\\f0\\fcharset1252}}\\'41}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('A');
            });

            it('should ignore text inside htmlrtf ignores', async () => {
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0}}\\htmlrtf hello\\htmlrtf0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.be.an('array').of.length(0);

                expect(result.asText).to.eql('');
            });

            it('should track htmlrtf state in groups', async () => {
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f0}}\\htmlrtf{\\htmlrtf0}hello\\htmlrtf0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.be.an('array').of.length(0);

                expect(result.asText).to.eql('');
            });

            it('should track \\f changes inside htmlrtf ignores', async () => {
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f1\\cpg1253}}\\htmlrtf\\f1\\htmlrtf0\\'f0}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp1253']);

                expect(result.asText).to.eql('π');
            });

            it('should buffer multiple text runs to decode at once', async () => {
                const input = "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0{\\fonttbl{\\f1\\cpg936}}\\htmlrtf\\f1\\htmlrtf0\\'a5\\'c6\\'a5\\'e5}";
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.deep.equal(['cp936']);

                expect(result.asText).to.eql('テュ');
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
                expect(result.decodings).to.deep.equal(['cp1252']);

                expect(result.asText).to.eql('<li>Item 1<o:p></o:p></li>');
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
                expect(result.decodings).to.be.an('array').of.length(0);

                expect(result.asText).to.eql('');
            });

            it('should ignore any optional destinations (even unknown ones)', async () => {
                const input = [
                    '{\\rtf1\\ansi\\fbidis\\ansicpg936\\deff0\\fromhtml1{\\fonttbl}',
                    '{\\*\\someNewGroup some stupid text;}',
                    '}'
                ];
                const result = await process(input);

                expect(result.warnings).to.be.an('array').of.length(0);
                expect(result.decodings).to.be.an('array').of.length(0);

                expect(result.asText).to.eql('');
            });
        });

        it('should handle deeply nested HTML in reasonable time', async () => {
            const input = [
                `{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\t6\\t7`,
                `{\\*\\htmltag <font color="#0000ff">}\\htmlrtf {\\htmlrtf0`.repeat(1000),
                `hi`,
                `{\\*\\htmltag </font>}\\htmlrtf }\\htmlrtf0`.repeat(1000),
                `}`];
            const result = await process(input);

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.include('hi');
        }).timeout(1000);
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
            expect(result.decodings).to.be.an('array').of.length(0);

            expect(result.asText).to.eql('😀');
        });

        it('should properly de-encapsulate in "text" mode', async () => {
            const result = await process(input, { mode: 'text' });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.eql(`Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n`);
        });

        it('should properly de-encapsulate in "either" mode', async () => {
            const result = await process(input, { mode: 'either' });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.eql(`Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n`);
        });

        it('should properly prefix with "text:" if requested', async () => {
            const result = await process(input, { mode: 'either', prefix: true });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.eql(`text:Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n`);
        });

        it('should handle \\par and \\line both as CRLF', async () => {
            const input = "{\\rtf1\\ansi\\ansicpg1252\\fromtext{{{{{{\\par\\line\\tab}}}}}}}";
            const result = await process(input, { mode: 'text' });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.be.an('array').of.length(0);

            expect(result.asText).to.eql('\r\n\r\n\t');
        });
    });

    describe('symbolic fonts', async () => {
        it('should treat symbolic font characters as literal Unicode codepoints by default', async () => {
            const input = `{\\rtf1\\ansi\\ansicpg65001\\fromtext\\uc0{\\fonttbl`
                + `{\\f0\\fswiss\\fcharset2 Wingdings;}{\\f1\\fswiss\\fcharset0 Times New Roman;}}`
                + `{\\f0\\'80\\u128\\u-10179\\u-8704}\\par`
                + `{\\f1\\'80\\u128\\u-10179\\u-8704}}`;

            const result = await process(input);

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.eql(`\u0080\u0080😀\r\n€\u0080😀`);
        });

        it('should treat 0xF000-0xF0FF the same as 0x0000-0x00FF', async () => {
            const input = `{\\rtf1\\ansi\\ansicpg65001\\fromtext\\uc0{\\fonttbl`
                + `{\\f0\\fswiss\\fcharset2 Wingdings;}{\\f1\\fswiss\\fcharset0 Times New Roman;}}`
                + `{\\f0\\'80\\u128\\u-3968\\u-10179\\u-8704}\\par`
                + `{\\f1\\'80\\u128\\u-3968\\u-10179\\u-8704}}`;

            const result = await process(input);

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.eql(`\u0080\u0080\u0080😀\r\n€\u0080\uF080😀`);
        });

        it('should allow re-coding Wingdings to Unicode', async () => {
            const input = `{\\rtf1\\ansi\\ansicpg65001\\fromtext\\uc0{\\fonttbl`
                + `{\\f0\\fswiss\\fcharset2 Wingdings;}{\\f1\\fswiss\\fcharset0 Times New Roman;}}`
                + `{\\f0\\'80\\u128\\'4b\\u-10179\\u-8704}\\par`
                + `{\\f1\\'80\\u128\\'4b\\u-10179\\u-8704}}`;

            const result = await process(input, {
                replaceSymbolFontChars: true
            });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.eql(`⓪⓪😐😀\r\n€\u0080K😀`);
        });

        it('should treat 0xF000-0xF0FF the same as 0x0000-0x00FF when re-coding', async () => {
            const input = `{\\rtf1\\ansi\\ansicpg65001\\fromtext\\uc0{\\fonttbl`
                + `{\\f0\\fswiss\\fcharset2 Wingdings;}{\\f1\\fswiss\\fcharset0 Times New Roman;}}`
                + `{\\f0\\'80\\u128\\u-3968\\u-10179\\u-8704}\\par`
                + `{\\f1\\'80\\u128\\u-3968\\u-10179\\u-8704}}`;

            const result = await process(input, {
                replaceSymbolFontChars: true
            });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.eql(`⓪⓪⓪😀\r\n€\u0080\uF080😀`);
        });

        it('should allow text escapes and non-ASCII in font names', async () => {
            const input = `{\\rtf1\\ansi\\ansicpg65001\\fromtext\\uc0{\\fonttbl`
                + `{\\f0\\fswiss\\fcharset2 \\'57ing\\u100ings;}{\\f1\\fswiss\\fcharset0 Times \\'D1ew Roman \\u-10179\\u-8704;}}`
                + `{\\f0\\'80\\u128\\u-3968\\u-10179\\u-8704}\\par`
                + `{\\f1\\'80\\u128\\u-3968\\u-10179\\u-8704}}`;

            const result = await process(input, {
                replaceSymbolFontChars: true
            });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.deep.equal(['cp1252']);

            expect(result.asText).to.eql(`⓪⓪⓪😀\r\n€\u0080\uF080😀`);
        });
    });

    describe('additional options', async () => {
        it('should allow output as UTF-8 Buffers', async () => {
            const input = `{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\uc0\\deff0{\\fonttbl{\\f0\\cpg65001}}\\'e2\\'80\\'98hi\\u8217}`;
            const result = await process(input, {
                outputMode: 'buffer-utf8'
            });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.be.an('array').of.length(0);

            expect(Buffer.isBuffer(result.results[0])).to.be.true;
            expect(result.asBuffer.toString('utf8')).to.eql(`‘hi’`);
        });

        it('should allow output as default-encoded Buffers', async () => {
            const input = `{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\uc0\\deff0{\\fonttbl{\\f0\\cpg65001}}\\'e2\\'80\\'98hi\\u8217}`;
            const result = await process(input, {
                outputMode: 'buffer-default-cpg'
            });

            expect(result.warnings).to.be.an('array').of.length(0);
            expect(result.decodings).to.be.an('array').of.length(0);
            expect(result.encodings).to.deep.equal(['cp1252']);

            expect(Buffer.isBuffer(result.results[0])).to.be.true;
            // Check for cp1252 bytes
            expect(result.asBuffer[0]).that.equal(0x91);
            expect(result.asBuffer[3]).that.equal(0x92);
        });

        it('should natively handle cpg1200 re-coding', async () => {
            const input = await fs.promises.readFile('test/examples/cpg1200.rtf');
            const result = await process(input, {
                outputMode: 'buffer-default-cpg'
            });

            expect(result.warnings).to.be.an('array').of.length(1);
            expect(result.decodings).to.be.an('array').of.length(2);

            expect(result.asBuffer.toString('utf16le')).to.eql(`Plain text body: ! < > " ' € œ ¤ ´ ¼ ½ 𠜎 𩶘 😀\r\n`);
        });
    });

    it('should properly decapsulate the spec example', async () => {
        const options: Partial<DeEncapsulateOptions> = {
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
        const options: Partial<DeEncapsulateOptions> = {
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
