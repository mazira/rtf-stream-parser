import { TokenCountGlobalState } from './countTokens.types';
import { FeatureHandler } from './types';

export const countTokens: FeatureHandler<TokenCountGlobalState> = {
    allTokenHandler: global => {
        ++global._count;
    }
}