/**
 * This depends on the group feature and should come after it
 */

import { TokenType } from '../tokenize';
import { isNum } from '../utils';
import { UnicodeGlobalState } from './handleUnicode.types';
import { ControlHandlers, FeatureHandler, TokenHandlers } from './types';

const tokenHandlers: TokenHandlers<UnicodeGlobalState> = {
    [TokenType.GROUP_START]: globals => {
        globals._skip = 0;
    },

    [TokenType.GROUP_END]: globals => {
        globals._skip = 0;
    },

    [TokenType.CONTROL]: globals => {
        // Skip the control token if skipping after \u
        if (globals._skip > 0) {
            globals._skip--;
            return true;
        }
    },

    [TokenType.TEXT]: (globals, token) => {
        // Check if we should be skipping the whole text...
        if (globals._skip >= token.data.length) {
            globals._skip -= token.data.length;
            return true;
        }

        // We are skipping some, slice the data!
        if (globals._skip > 0) {
            token.data = token.data.slice(globals._skip);
            globals._skip = 0;
        }
    },
};

const unicodeControlHandlers: ControlHandlers<UnicodeGlobalState> = {
    // Handle Unicode escapes
    uc: (global, token) => {
        global._state.uc = token.param || 0;
    },

    u: (global, token) => {
        if (!isNum(token.param)) {
            throw new Error('Unicode control word with no param');
        }

        global._skip = global._state.uc;

        if (token.param < 0) {
            return String.fromCodePoint(token.param + 0x10000);
        } else {
            return String.fromCodePoint(token.param);
        }
    }
}

export const handleUnicode: FeatureHandler<UnicodeGlobalState> = {
    tokenHandlers: tokenHandlers,
    controlHandlers: unicodeControlHandlers,
}