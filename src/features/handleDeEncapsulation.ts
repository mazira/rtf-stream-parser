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
    /**
     * From spec:
     * 
     * 2.2.3.1 Recognizing RTF Containing Encapsulation
     * During the inspection, the de-encapsulating RTF reader SHOULD conclude that there is no encapsulated content and
     * that this is a normal (pure) RTF document if any of the following conditions are true:
     *
     * There are any RTF tokens besides the begin group mark "{" or a control word within the first 10 tokens.
     *
     * There is no FROMHTML or FROMTEXT control word within the first 10 tokens. 
     * 
     * ---
     * RDJ - Outlook doesn't seem to adhear to this perfectly, as some RTF files have been seen with a /fromhtml1 within
     * the first 10, and some other "\*\htmltag1 <!DOCTYPE html PUBLIC" within the first 10, and it is still treated
     * as encapsulated.
     */
    if (!global._fromhtml && !global._fromtext){
        if (token.type === TokenType.TEXT || global._count > 10) {
            throw getModeError(global);
        }
    }

    // Handle htmlrtf control word and rtf supression, done here to also supress
    // normal group tokens { }
    if (global._state.htmlrtf && global._options.outlookQuirksMode) {
        // Ignore any tokens that are not \f
        if (token.type !== TokenType.CONTROL || (token.word !== 'f' && token.word !== 'htmlrtf')) {
            return true;
        }
    }
};

const deEncapsulationControlHandlers: ControlHandlers<DeEncapsulationGlobalState> = {
    fromhtml: global => {
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
            global._pushOutput('html:');
        }

        return true;
    },

    fromtext: global => {
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
            global._pushOutput('text:');
        }

        return true;
    },

    htmlrtf: (global, token) => {
        // Outside or inside htmltag, surpression tags
        const on = token.param !== 0;
        global._state.htmlrtf = on;
    }
};

export const handleDeEncapsulation: FeatureHandler<DeEncapsulationGlobalState> = {
    allTokenHandler: allTokenHandler,
    controlHandlers: deEncapsulationControlHandlers,
    outputDataFilter: global => {
        // Outside or inside of htmltag, ignore anything in htmlrtf group
        if (global._state.htmlrtf) {
            return true;
        }

        const allDests = global._state.allDestinations || {};

        const insideHtmltag = !!allDests['htmltag'];

        // Outside of htmltag, ignore anything in ignorable group
        if (!insideHtmltag && global._state.destIgnorable) {
            return true;
        }

        // Outside of htmltag, ignore anything in known non-output groups
        if (!insideHtmltag && (allDests['fonttbl'] || allDests['colortbl'] || allDests['stylesheet'] || allDests['pntext'])) {
            return true;
        }
    },

    preStreamFlushHandler: global => {
        if (!global._fromhtml && !global._fromtext) {
            throw getModeError(global);
        }
    }
};
