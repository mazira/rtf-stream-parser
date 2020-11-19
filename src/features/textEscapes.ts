/**
 * This depends on the group feature and should come after it
 * This should probably come after the Unicode feature
 */

import { OutputGlobalState } from './handleOutput.types';
import { FeatureHandler } from './types';

export const handleTextEscapes: FeatureHandler<OutputGlobalState> = {
    controlHandlers: {
        // Control words
        par: globals => globals._pushOutput('\r\n'),
        line: globals => globals._pushOutput('\r\n'),
        tab: globals => globals._pushOutput('\t'),

        lquote: globals => globals._pushOutput('\u2018'),
        rquote: globals => globals._pushOutput('\u2019'),
        ldblquote: globals => globals._pushOutput('\u201C'),
        rdblquote: globals => globals._pushOutput('\u201D'),
        bullet: globals => globals._pushOutput('\u2022'),
        endash: globals => globals._pushOutput('\u2013'),
        emdash: globals => globals._pushOutput('\u2014'),

        // Control symbols
        '{': globals => globals._pushOutput('{'),
        '}': globals => globals._pushOutput('}'),
        '\\': globals => globals._pushOutput('\\'),
        '~': globals => globals._pushOutput('\u00A0'),
        '_': globals => globals._pushOutput('\u00AD'),
    }
}
