/**
 * This depends on the group feature and should come after it
 * This should probably come after the Unicode feature
 */

import { TokenType } from '../tokenize';
import { words, WordType } from '../words';
import { ControlAndDestinationGlobalState, ControlAndDestinationGroupState, DestinationSet } from './handleControlsAndDestinations.types';
import { ControlHandlers, FeatureHandler } from './types';

function addDestination(state: ControlAndDestinationGroupState, destination: string) {
    state.destDepth = (state.destDepth || 0) + 1;
    state.destGroupDepth = state.groupDepth;

    // Track the new destination
    if (!state.allDestinations) {
        state.allDestinations = {};
        state.allDestinations[destination] = true;
    } else if (!state.allDestinations[destination]) {
        state.allDestinations = Object.create(state.allDestinations) as DestinationSet;
        state.allDestinations[destination] = true;
    }
}

const destinationControlHandlers: ControlHandlers<ControlAndDestinationGlobalState> = {
    [TokenType.CONTROL]: (global, token) => {
        const wordType = words[token.word] || WordType.UNKNOWN;

        if (wordType === WordType.DESTINATION) {
            if (global._lastToken && global._lastToken.type === TokenType.GROUP_START) {
                global._state.destination = token.word;
                global._state.destIgnorableImmediate = false;

                addDestination(global._state, token.word!);
            } else if (global._lastToken && global._lastLastToken
                && global._lastToken.type === TokenType.CONTROL && global._lastToken.word === '*'
                && global._lastLastToken.type === TokenType.GROUP_START
            ) {
                global._state.destination = token.word;
                global._state.destIgnorableImmediate = global._state.destIgnorable = true;

                addDestination(global._state, token.word!);
            } else {
                global._options.warn('Got destination control word but not immediately after "{" or "{\\*": ' + token.word);
            }
        } else if (wordType === WordType.UNKNOWN) {
            // For control words that are unknown... check if they appear to be
            // optional destinations (because then we can ignore any text)
            if (global._lastToken && global._lastLastToken
                && global._lastToken.type === TokenType.CONTROL && global._lastToken.word === '*'
                && global._lastLastToken.type === TokenType.GROUP_START
            ) {
                global._state.destination = token.word;
                global._state.destIgnorableImmediate = global._state.destIgnorable = true;

                addDestination(global._state, token.word!);
            }
        }
    },
}

export const handleControlsAndDestinations: FeatureHandler<ControlAndDestinationGlobalState> = {
    tokenHandlers: destinationControlHandlers,
    allTokenHandler: (global, token) => {
        global._lastLastToken = global._lastToken;
        global._lastToken = global._currToken;
        global._currToken = token;
    }
}
