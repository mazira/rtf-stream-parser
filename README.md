# rtf-stream-parser
Contains a native Node stream classes for parsing Rich Text Format (RTF) into token
objects, and another for de-encapsulating embedded HTML content. We use this
code in [GoldFynch](https://goldfynch.com), an e-discovery platform, for extracting HTML email bodies that have passed through Outlook mail systems.

## Simple Usage

```javascript
const fs = require('fs');
const {Tokenize, DeEncapsulate} = require('rtf-stream-parser');

const input = fs.createReadStream('encapsulated.rtf');
const output = fs.createWriteStream('output.html');

input.pipe(new Tokenize())
     .pipe(new DeEncapsulate())
     .pipe(output);
```

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
    type: 'CONTROL' | 'TEXT' | 'GROUP_START' | 'GROUP_END';

    // For control words / symbols, the name of the word / symbol.
    word?: string;

    // The optional numerical parameter that control words may have.
    param?: number;

    // Binary data from `\binN` and `'XX` controls as well as string literals.
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

This class takes RTF-ecapsuulated-HTML data,
[de-encapsualtes it](https://msdn.microsoft.com/en-us/library/ee159984(v=exchg.80).aspx),
and produces HTML output.
This Transform class takes tokenized object output from the Tokenize class and produces string chunks of output HTML.

Apart from it's specific use, this class also serves as an example of how to consume
and use the Tokenize class.

## Future Work

Currently, the Tokenize class is pretty low level, and the DeEncapsulate class is very use-case specific. Some work could be done to abstract the generally-useful parts of the DeEncapsulate class into a more generic consumer.