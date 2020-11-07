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
        if (global._state.destination !== 'rtf') {
            throw new Error('\\ansicpg not at root group');
        }
        if (global._ansicpg) {
            throw new Error('\\ansicpg already defined');
        }
        if (!isNum(token.param)) {
            throw new Error('\\ansicpg with no param');
        }

        global._ansicpg = true;
        global._cpg = token.param;
    },
}

export const handleCharacterSet: FeatureHandler<FontGlobalState> = {
    controlHandlers: characterSetControlHandlers,
};
