/**
 * This depends on the group feature and should come after it
 */

import { Token, TokenType } from '../tokenize';
import { isNum } from '../utils';
import { OutputGlobalState } from './handleOutput.types';
import { ControlHandlers, FeatureHandler, TokenHandler, TokenHandlers } from './types';

function flushBuffers(global: OutputGlobalState) {
    if (global._bufferedUnicodeOutput) {
        // We got some other control token that is not a chain of Unicode
        const str = global._bufferedUnicodeOutput.join('');
        global._pushOutput(str);
        delete global._bufferedUnicodeOutput;
    }

    if (global._bufferedBinaryOutput) {
        // We got some other control token that is not a chain of hex escapes
        global._pushOutput(Buffer.concat(global._bufferedBinaryOutput));
        delete global._bufferedBinaryOutput;
    }
}

const allTokenHandler: TokenHandler<OutputGlobalState, Token> = (global, token) => {
    if (global._bufferedUnicodeOutput && (token.type !== TokenType.CONTROL || (token.word !== 'uc' && token.word !== 'u'))) {
        // Continue Buffering Unicode as long as we get \uc or \u control words
        flushBuffers(global);
    } else if (global._bufferedBinaryOutput && (token.type !== TokenType.CONTROL || token.word !== "'")) {
        // Continue Buffering Unicode as long as we get \' control words
        flushBuffers(global);
    }
}

const tokenHandlers: TokenHandlers<OutputGlobalState> = {
    /*
        [TokenType.GROUP_START]: flushBuffers,
        [TokenType.GROUP_END]: flushBuffers,
        [TokenType.CONTROL]: (global, token) => {
            if (global._bufferedUnicodeOutput && token.word !== 'uc' && token.word !== 'u') {
                flushBuffers(global);
            }
    
            if (global._bufferedBinaryOutput && token.word !== "'") {
                flushBuffers(global);
            }
        },
    */
    [TokenType.TEXT]: (globals, token) => {
        flushBuffers(globals);

        // Emit the text
        globals._pushOutput(token.data);
    },
};

const unicodeControlHandlers: ControlHandlers<OutputGlobalState> = {
    u: (global, token) => {
        if (!isNum(token.param)) {
            throw new Error('Unicode control word with no param');
        }

        const newCodeUnit = token.param < 0
            ? String.fromCodePoint(token.param + 0x10000)
            : String.fromCodePoint(token.param);

        global._bufferedUnicodeOutput = global._bufferedUnicodeOutput || [];
        global._bufferedUnicodeOutput.push(newCodeUnit);
    },


    // Special one for hex escape
    "'": (global, token) => {
        global._bufferedBinaryOutput = global._bufferedBinaryOutput || [];
        global._bufferedBinaryOutput.push(token.data!);
    }
}


export const handleOutput: FeatureHandler<OutputGlobalState> = {
    allTokenHandler: allTokenHandler,
    tokenHandlers: tokenHandlers,
    controlHandlers: unicodeControlHandlers,
}
