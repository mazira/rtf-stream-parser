import { isNum } from '../utils';
import { CharacterSetGlobalState } from './handleCharacterSet.types';
import { FontGlobalState } from './handleFonts.types';
import { ControlHandlers, FeatureHandler } from './types';

const characterSetControlHandlers: ControlHandlers<CharacterSetGlobalState> = {
    mac: () => {
        throw new Error('Unsupported character set \\mac');
    },
    pc: () => {
        throw new Error('Unsupported character set \\pc');
    },
    pca: () => {
        throw new Error('Unsupported character set \\pca');
    },
    ansicpg: (global, token) => {
        // Ignore \ansicpg in some non-root \rtf group
        if (global._state.destination === 'rtf' && global._state.destDepth > 1 && global._ansicpg) {
            return;
        }

        if (global._ansicpg) {
            global._options.warn('\\ansicpg already defined');
            return;
        }
        if (!isNum(token.param)) {
            global._options.warn('\\ansicpg with no param');
            return;
        }

        global._ansicpg = true;
        global._cpg = token.param;
    },
};

export const handleCharacterSet: FeatureHandler<FontGlobalState> = {
    controlHandlers: characterSetControlHandlers,
};
