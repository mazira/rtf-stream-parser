/**
 * This depends on the group feature and should come after it
 */

import { Token, TokenType } from '../tokenize';
import { UnicodeSkipGlobalState } from './handleUnicodeSkip.types';
import { ControlHandlers, FeatureHandler, TokenHandler } from './types';

const allTokenHandler: TokenHandler<UnicodeSkipGlobalState, Token> = (globals, token) => {
    switch (token.type) {
        case TokenType.GROUP_START:
        case TokenType.GROUP_END:
            globals._skip = 0;
            break;

        case TokenType.CONTROL:
            // Skip the control token if skipping after \u
            if (globals._skip > 0) {
                globals._skip--;
                return true;
            }
            break;

        case TokenType.TEXT:
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
            break;
    }
};

const unicodeSkipControlHandlers: ControlHandlers<UnicodeSkipGlobalState> = {
    // Handle Unicode escapes
    uc: (global, token) => {
        global._state.uc = token.param || 0;
    },

    u: global => {
        global._skip = global._state.uc;
    }
};

export const handleUnicodeSkip: FeatureHandler<UnicodeSkipGlobalState> = {
    allTokenHandler: allTokenHandler,
    controlHandlers: unicodeSkipControlHandlers,
};
