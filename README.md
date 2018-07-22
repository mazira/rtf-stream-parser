# rtf-stream-parser
This module is primarily used to extract RTF-encapsulated text and HTML. This module exposes high-level functions where you may pass in an RTF string, Buffer, or stream, and get out the de-encapsulated content. Additionally, this module contains two lower level stream Transform classes that handle the tokenization and de-encapsulation processs and may be used for other low-level operations.

This code is used in production at [GoldFynch](https://goldfynch.com), an e-discovery platform, for extracting HTML and text email bodies that have passed through Outlook mail systems.

## Simple Usage
This module generally needs to be used with an expanded string decoder Gbrary such as [iconv-lite](https://github.com/ashtuchkin/iconv-lite) or [iconv](https://www.npmjs.com/package/iconv) in order to handle the ANSI various codepages commonly found in RTF. The string decoding is done via a callback that is passed in an options object.

### Using iconv-lite
```javascript
import * as iconvLite from 'iconv-lite';
import { deEncapsulateSync } from 'rtf-stream-parser';

const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromtext{{{{{{hello}}}}}}}';
const result = deEncapsulateSync(rtf, { decode: iconvLite.decode });
console.log(result); // { mode: 'text', text: 'hello' }
```

### Using iconv
```javascript
import * as iconv from 'iconv';
import { deEncapsulateSync } from 'rtf-stream-parser';

const decode = (buf, enc) => {
    const converter = new iconv.Iconv(enc, 'UTF-8//TRANSLIT//IGNORE');
    return converter.convert(buf).toString('utf8');
};

const rtf = '{\\rtf1\\ansi\\ansicpg1252\\fromtext{{{{{{hello}}}}}}}';
const result = deEncapsulateSync(rtf, { decode: decode });
console.log(result); // { mode: 'text', text: 'hello' }
```

### De-encapsulating a stream (async buffered result)
```javascript
import * as fs from 'fs';
import * as iconvLite from 'iconv-lite';
import { deEncapsulateStream } from 'rtf-stream-parser';

const stream = fs.createReadStream('encapsulated.rtf');
deEncapsulateStream(stream, { decode: iconvLite.decode }).then(result => {
    console.log(result); // { mode: '...', text: '... }
});
```

### De-encapsulating a stream (streaming result)
```javascript
import * as fs from 'fs';
import * as iconvLite from 'iconv-lite';
import { Tokenize, DeEncapsulate } from 'rtf-stream-parser';

const input = fs.createReadStream('encapsulated.rtf');
const output = fs.createWriteStream('output.html');

input.pipe(new Tokenize())
     .pipe(new DeEncapsulate({
         decode: iconvLite.decode
         mode'either'
     })
     .pipe(output);
```

## High-level functions
### deEncapsulateSync(input[, options])
* `input` - `<string>` | `<Buffer>` The RTF data. Buffers recommended to avoid encoding issues.
* `options` - `<Object>` De-encapsulation options.
    * `warn` - `<Function>` A callback function that takes a single string message argument. Used to warn of RTF or decoding issues. Defaults to `console.warn`.
    * `decode` - `<Function>` A callback function that takes a Buffer data argument and a string argument indicating the encoding, e.g. `"cp1252"`.
* Returns: `<Object>` The de-encapsulation result.
    * mode - `"html"` or `"text"`. Indicates whether the RTF data contained encapsulated HTML or text data.
    * text - `<string>` The de-encapsulated HTML or text.
 
This function de-encapsulates HTML or text data from an RTF string or Buffer. Throws an error if the given RTF does not contain encapsulated data.

### deEncapsulateStream(input[, options])
* `input` - `<ReadableStream>` The RTF data. Buffer streams recommended (without an encoding set).
* `options` - `<Object>` De-encapsulation options.
    * `warn` - `<Function>` A callback function that takes a single string message argument. Used to warn of RTF or decoding issues. Defaults to `console.warn`.
    * `decode` - `<Function>` A callback function that takes a Buffer data argument and a string argument indicating the encoding, e.g. `"cp1252"`.
* Returns: `<Promise<Object>>` The de-encapsulation result.
    * mode - `"html"` or `"text"`. Indicates whether the RTF data contained encapsulated HTML or text data.
    * text - `<string>` The de-encapsulated HTML or text.
 
This function de-encapsulates HTML or text data from an RTF string or Buffer. Throws an error if the given RTF does not contain encapsulated data.

## Tokenize Class
A low-level parser & tokenizer of incoming RTF data. This
[Transform](https://nodejs.org/api/stream.html#stream_duplex_and_transform_streams)
stream takes input of raw RTF data, generally in the form of `Buffer` chunks, and generates
["object mode"](https://nodejs.org/api/stream.html#stream_object_mode)
output chunks representing the parsed RTF operations. String input chunks are
also accepted, but are converted to `Buffer` based on the stream's
[default string encoding](https://nodejs.org/api/stream.html#stream_writable_setdefaultencoding_encoding).

The output objects have the following format:
```
{
    // The type of the token.
    type: number; // GROUP_START = 0, GROUP_END = 1, CONTROL = 2, TEXT = 3

    // For control words / symbols, the name of the word / symbol.
    word?: string;

    // The optional numerical parameter that control words may have.
    param?: number;

    // Binary data from `\binN` and `\'XX` controls as well as string literals.
    // String literals are kept as binary due to unknown encoding at this
    // level of processing.
    data?: Buffer
}
```

### Notes:
- Unicode characters (`\uN`) will populate the `param` property with the code point `N`.
- At this level, the parser isn't aware of which control words represent destinations,
so destination groups will be output as a `GROUP_START` token followed by a `CONTROL` token. It is left to further processors to determine if the control word represents a destination.
- Optional destination groups (`{\*\destination ...}`) will be output as three tokens (CONTROL_START, CONTROL for `*`, and CONTROL for `destination`).

## De-Encapsulate Class

This class takes RTF-ecapsuulated text (HTML or text),
[de-encapsulates it](https://msdn.microsoft.com/en-us/library/ee159984(v=exchg.80).aspx),
and produces a string output.
This Transform class takes tokenized object output from the Tokenize class and produces string chunks of output HTML.

Apart from it's specific use, this class also serves as an example of how to consume
and use the Tokenize class.

The constructor takes two optional arguments:
```javascript
new DeEncapsulate(options);
```
* `options` - `<Object>` De-encapsulation options.
    * `warn` - `<Function>` A callback function that takes a single string message argument. Used to warn of RTF or decoding issues. Defaults to `console.warn`.
    * `decode` - `<Function>` A callback function that takes a Buffer data argument and a string argument indicating the encoding, e.g. `"cp1252"`.
    * `mode` - `"html"`, `"text"`, or `"other"`. Whether to only accept encapsulated HTML or text. Defaults to `"html"`. If the given RTF stream is not encapsulated text, or does not match the given mode (e.g. is encapsulated text but mode is set to `"html"`), the stream will emit an error.
    * `prefix` - `true` or `false`. If `true`, the output text will have either `"html:"` or `"text:"` prefixed to the output string. This is helpful for detecting the encapsulation mode when using `"either"`. Defaults to false.


## Changes from 1.X.X
* Converted to source and tests to TypeScript
* Added additional de-encapsulation options to specify custom string decoder, and to capture warning output.
* Added high-level functions for common de-encapsulation tasks
* Switched objects from the Tokenize stream to represent the token type with an enum instead of a string.
* Switched the control word dictionary used by the DeEncapsulate stream to use enums for better minification.

## Future Work

Currently, the Tokenize class is pretty low level, and the DeEncapsulate class is very use-case specific. Some work could be done to abstract the generally-useful parts of the DeEncapsulate class into a more generic consumer. I would also like to add build-in support for all codepages mentioned in the RTF spec. 