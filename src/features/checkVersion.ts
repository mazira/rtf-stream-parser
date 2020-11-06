import { TokenType } from '../tokenize';
import { GlobalTokenCountState } from './countTokens.types';
import { FeatureHandler } from './types';

export const checkVersion: FeatureHandler<GlobalTokenCountState> = {
    allTokenHandler: (global, token) => {
        // First token should be {
        if (global._count === 1 && token.type !== TokenType.GROUP_START) {
            throw new Error('File should start with "{"');
        }

        // Second token should be \rtf1
        if (global._count === 2 && (token.word !== 'rtf' || (token.param !== 0 && token.param !== 1))) {
            throw new Error('File should start with "{\\rtf[0,1]"');
        }
    },
    preFlushHandler: global => {
        if (global._count === 0) {
            throw new Error('File should start with "{"');
        } else if (global._count === 1) {
            throw new Error('File should start with "{\\rtf"');
        }
    }
}