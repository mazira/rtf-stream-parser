import { Token, TokenType } from '../tokenize';
import { GroupGlobalState, GroupState } from './handleGroupState.types';
import { FeatureHandler, TokenHandler, TokenHandlers } from './types';

const allTokenhandler: TokenHandler<GroupGlobalState, Token> = global => {
    // Warn and skip if we have any tokens after final }
    if (global._done) {
        global._options.warn('Additional tokens after final closing bracket');
        // Ignore any further processing
        return true;
    }
}

const groupTokenHandlers: TokenHandlers<GroupGlobalState> = {
    [TokenType.GROUP_START]: global => {
        // Make new state based on current
        const oldState = global._state;
        const newState: GroupState = Object.create(oldState);
        ++newState.groupDepth;
        global._state = newState;
    },

    [TokenType.GROUP_END]: global => {
        global._state = Object.getPrototypeOf(global._state);
        if (global._state === global._rootState) {
            global._done = true;
        }
    },
}

export const handleGroupState: FeatureHandler<GroupGlobalState> = {
    allTokenHandler: allTokenhandler,
    tokenHandlers: groupTokenHandlers,
    preStreamFlushHandler: global => {
        if (global._state !== global._rootState) {
            global._options.warn('Not enough matching closing brackets');
        }
    }
}