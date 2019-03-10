import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as fs from 'fs';
import * as iconvLite from 'iconv-lite';
import { Options } from '../src/de-encapsulate';
import * as index from '../src/index';

chai.use(chaiAsPromised);
const expect = chai.expect;

// Test
const example1Html = fs.readFileSync('test/examples/encapsulated.html', 'utf8');
const example2Text = fs.readFileSync('test/examples/jis-test.txt', 'utf8');

const options: Options = {
    decode: iconvLite.decode,
    warn: () => { }
};

describe('deEncapsulateSync', () => {
    describe('with the spec fromhtml example', () => {
        it('should properly handle Buffer input', () => {
            const input = fs.readFileSync('test/examples/encapsulated.rtf');
            const output = index.deEncapsulateSync(input, options);
            expect(output).to.deep.equal({
                mode: 'html',
                text: example1Html
            });
        });

        it('should properly handle string input', () => {
            const input = fs.readFileSync('test/examples/encapsulated.rtf', 'utf8');
            const output = index.deEncapsulateSync(input, options);
            expect(output).to.deep.equal({
                mode: 'html',
                text: example1Html
            });
        });
    });

    describe('with the JIS fromtext example', () => {
        it('should properly handle Buffer input', () => {
            const input = fs.readFileSync('test/examples/jis-test.rtf');
            const output = index.deEncapsulateSync(input, options);
            expect(output).to.deep.equal({
                mode: 'text',
                text: example2Text
            });
        });

        it('should properly handle string input', () => {
            const input = fs.readFileSync('test/examples/jis-test.rtf', 'utf8');
            const output = index.deEncapsulateSync(input, options);
            expect(output).to.deep.equal({
                mode: 'text',
                text: example2Text
            });
        });
    });
});

describe('deEncapsulateStream', () => {
    describe('with the spec fromhtml example', () => {
        it('should properly handle Buffer stream input', async () => {
            const input = fs.createReadStream('test/examples/encapsulated.rtf');
            const output = await index.deEncapsulateStream(input, options);
            expect(output).to.deep.equal({
                mode: 'html',
                text: example1Html
            });
        });

        it('should properly handle string stream input', async () => {
            const input = fs.createReadStream('test/examples/encapsulated.rtf', 'utf8');
            const output = await index.deEncapsulateStream(input, options);
            expect(output).to.deep.equal({
                mode: 'html',
                text: example1Html
            });
        });
    });

    describe('with the JIS fromtext example', () => {
        it('should properly handle Buffer input', async () => {
            const input = fs.createReadStream('test/examples/jis-test.rtf');
            const output = await index.deEncapsulateStream(input, options);
            expect(output).to.deep.equal({
                mode: 'text',
                text: example2Text
            });
        });

        it('should properly handle string input', async () => {
            const input = fs.createReadStream('test/examples/jis-test.rtf', 'utf8');
            const output = await index.deEncapsulateStream(input, options);
            expect(output).to.deep.equal({
                mode: 'text',
                text: example2Text
            });
        });
    });
});