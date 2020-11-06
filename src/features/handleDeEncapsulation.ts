/**
 * This depends on the group feature and the contro & destination feature, and should come after them
 */

import { Token, TokenType } from '../tokenize';
import { DeEncapsulationGlobalState } from './handleDeEncapsulation.types';
import { ControlHandlers, FeatureHandler, TokenHandler } from './types';

function getModeError(global: DeEncapsulationGlobalState): Error {
    if (global._options.mode === 'html') {
        return new Error('Not encapsulated HTML file');
    } else if (global._options.mode === 'text') {
        return new Error('Not encapsulated text file');
    } else {
        return new Error('Not encapsulated HTML or text file');
    }
}

const allTokenHandler: TokenHandler<DeEncapsulationGlobalState, Token> = (global, token) => {
    // 2.2.3.1 Recognizing RTF Containing Encapsulation
    if (global._count <= 10) {
        if (token.type === TokenType.TEXT) {
            throw getModeError(global);
        }
    } else if (!global._fromhtml && !global._fromtext) {
        throw getModeError(global);
    }
};


const deEncapsulationControlHandlers: ControlHandlers<DeEncapsulationGlobalState> = {
    fromhtml: (global, token) => {
        if (global._state.destination !== 'rtf') {
            throw new Error('\\fromhtml not at root group');
        }
        if (global._fromhtml !== false || global._fromtext !== false) {
            throw new Error('\\fromhtml or \\fromtext already defined');
        }
        if (global._options.mode !== 'html' && global._options.mode !== 'either') {
            throw getModeError(global);
        }

        global._fromhtml = true;
        if (global._options.prefix) {
            return 'html:';
        } else {
            return true;
        }
    },

    fromtext: (global, token) => {
        if (global._state.destination !== 'rtf') {
            throw new Error('\\fromtext not at root group');
        }
        if (global._fromhtml !== false || global._fromtext !== false) {
            throw new Error('\\fromhtml or \\fromtext already defined');
        }
        if (global._options.mode !== 'text' && global._options.mode !== 'either') {
            throw getModeError(global);
        }

        global._fromtext = true;
        if (global._options.prefix) {
            return 'text:';
        } else {
            return true;
        }
    },
}

export const handleDeEncapsulation: FeatureHandler<DeEncapsulationGlobalState> = {
    allTokenHandler: allTokenHandler,
    controlHandlers: deEncapsulationControlHandlers,
    preFlushHandler: global => {
        if (!global._fromhtml && !global._fromtext) {
            throw getModeError(global);
        }
    }
}