# rtf-parser
Contains a native Node stream classes for parsing an RTF stream into tokens, and another for de-encapsulating embedded HTML content.

## Usage

```javascript
const fs = require('fs');
const {Tokenizer, DeEncapsulator} = require('rtf-parser');

const input = fs.createReadStream('encapsulated.rtf');
const output = fs.createWriteStream('output.html');

input.pipe(new Tokenizer())
     .pipe(new DeEncapsulator())
     .pipe(output);
```
