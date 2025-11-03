import { expect } from 'chai';
import { Readable } from 'stream';
import { streamFlow } from '../src/stream-flow';
import { Token, Tokenize, TokenType } from '../src/tokenize';

describe('Tokenize', () => {
    async function process(inputs: string[]): Promise<Token[]> {
        const streamIn = new Readable();
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        streamIn._read = () => { };
        const p = streamFlow(streamIn, new Tokenize());

        // Do in a timeout just to simulate more async-ness
        setTimeout(() => {
            for (const input of inputs) {
                streamIn.push(input);
            }
            streamIn.push(null);
        }, 1);

        const result = await p;
        return result as Token[];
    }

    it('should allow uppercase and lowercase control words', async () => {
        const result = await process(['\\word\\WoRd']);
        expect(result).to.be.an('array').of.length(2);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'word' });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: 'WoRd' });
    });

    it('should find control words across chunks', async () => {
        const result = await process(['\\wo', 'rd\\WoRd']);
        expect(result).to.be.an('array').of.length(2);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'word' });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: 'WoRd' });
    });

    it('should eat the optional space after control words', async () => {
        const result = await process(['\\word \\WoRd  ']);
        expect(result).to.be.an('array').of.length(3);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'word' });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: 'WoRd' });
        expect(result[2]).to.eql({ type: TokenType.TEXT, data: Buffer.from(' ', 'ascii') });
    });

    it('should not eat spaces after control sysmbols', async () => {
        const result = await process(['\\{ \\}  ']);
        expect(result).to.be.an('array').of.length(4);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: '{' });
        expect(result[1]).to.eql({ type: TokenType.TEXT, data: Buffer.from(' ', 'ascii') });
        expect(result[2]).to.eql({ type: TokenType.CONTROL, word: '}' });
        expect(result[3]).to.eql({ type: TokenType.TEXT, data: Buffer.from('  ', 'ascii') });
    });

    it('should allow control word numerical param', async () => {
        const result = await process(['\\word001\\WoRd123']);
        expect(result).to.be.an('array').of.length(2);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'word', param: 1 });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: 'WoRd', param: 123 });
    });

    it('should allow negative control word numerical param', async () => {
        const result = await process(['\\word-001\\WoRd-123']);
        expect(result).to.be.an('array').of.length(2);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'word', param: -1 });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: 'WoRd', param: -123 });
    });

    it('should return control symbols with "word" property', async () => {
        const result = await process(['\\word0 hi\\', '{\\\\\\', '}']);
        expect(result).to.be.an('array').of.length(5);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'word', param: 0 });
        expect(result[1]).to.eql({ type: TokenType.TEXT, data: Buffer.from('hi', 'ascii') });
        expect(result[2]).to.eql({ type: TokenType.CONTROL, word: '{' });
        expect(result[3]).to.eql({ type: TokenType.CONTROL, word: '\\' });
        expect(result[4]).to.eql({ type: TokenType.CONTROL, word: '}' });
    });

    it('should not detect control words in binary data', async () => {
        const result = await process(['\\bin', '4 \\hi2\\hi3']);
        expect(result).to.be.an('array').of.length(2);

        const buf = Buffer.from('\\hi2', 'ascii');
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'bin', param: 4, data: buf });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: 'hi', param: 3 });
    });

    it('should handle \\bin control word without positive param', async () => {
        const result = await process(['\\bin ', '\\bin0 \\bin-10 ']);
        expect(result).to.be.an('array').of.length(3);

        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'bin' });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: 'bin', param: 0 });
        expect(result[2]).to.eql({ type: TokenType.CONTROL, word: 'bin', param: -10 });
    });

    it('should handle \\bin control with early EOF', async () => {
        const result = await process(['\\bin10 hi']);
        expect(result).to.be.an('array').of.length(1);

        expect(result[0]).to.eql({
            type: TokenType.CONTROL, word: 'bin', param: 10, data: Buffer.from('hi', 'ascii')
        });
    });

    it('should handle optional \\*\destination control symbols', async () => {
        const result = await process(['{\\*\\destination}']);
        expect(result).to.be.an('array').of.length(4);

        expect(result[0]).to.eql({ type: TokenType.GROUP_START });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: '*' });
        expect(result[2]).to.eql({ type: TokenType.CONTROL, word: 'destination' });
        expect(result[3]).to.eql({ type: TokenType.GROUP_END });
    });

    it("should handle \\' hex escape", async () => {
        const result = await process(["\\'a0\\'FF"]);
        expect(result).to.be.an('array').of.length(2);

        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: "'", data: Buffer.from([160]) });
        expect(result[1]).to.eql({ type: TokenType.CONTROL, word: "'", data: Buffer.from([255]) });
    });

    it("should handle \\' hex escape early termination", async () => {
        const result = await process(["\\'F"]);
        expect(result).to.be.an('array').of.length(1);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: "'", data: Buffer.alloc(0) });

        const result2 = await process(["\\'"]);
        expect(result2).to.be.an('array').of.length(1);
        expect(result2[0]).to.eql({ type: TokenType.CONTROL, word: "'", data: Buffer.alloc(0) });
    });

    /**
     * From spec:
     * A carriage return (character value 13) or line feed (character value 10) is treated as a \par control if the
     * character is preceded by a backslash.
     */
    it('should handle \\[CR] and \\[LF] and other non-alpha symbols in a special way, leaving trailing text & numbers', async () => {
        const input = '\\par10\\\r10\\\n10\\~10\\tab10';

        const result = await process([input]);

        expect(result).to.be.an('array').of.length(8);
        expect(result[0]).to.eql({ type: TokenType.CONTROL, word: 'par', param: 10 });

        expect(result[6]).to.eql({ type: TokenType.TEXT, data: Buffer.from('10') });
        expect(result[7]).to.eql({ type: TokenType.CONTROL, word: 'tab', param: 10 });
    });

    it('should handle normal text in various chunks', async () => {
        for (const input of [['{hello how are you}'], ['{hello how ', 'are you}'], ['{hello how\r\n\r\n', ' are \r\nyou}']]) {
            const result = await process(input);

            expect(result).to.be.an('array').of.length(3);
            expect(result[0]).to.eql({ type: TokenType.GROUP_START });
            expect(result[1]).to.eql({ type: TokenType.TEXT, data: Buffer.from('hello how are you') });
            expect(result[2]).to.eql({ type: TokenType.GROUP_END });
        }
    });

    it('should work a very long text chunk in reasonable time', async () => {
        const repeatLen = 1024 * 1024 * 100;
        // 100 MB?
        // Previously taking 46s for 10 MB, 3m for 20 MB
        // Now taking 45ms for 20 MB, 204ms for 100 MB
        const input = ['{hello how are you' + '?'.repeat(repeatLen) + '}'];
        const result = await process(input);

        expect(result).to.be.an('array').of.length(3);
        expect(result[0]).to.eql({ type: TokenType.GROUP_START });
        expect(result[1].type).to.eql(TokenType.TEXT);
        expect(result[1].data?.toString('binary')).to.eql('hello how are you' + '?'.repeat(repeatLen));
        expect(result[2]).to.eql({ type: TokenType.GROUP_END });
    }).timeout(10 * 60000);
});
