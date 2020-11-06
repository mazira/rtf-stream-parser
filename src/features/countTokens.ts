import { GlobalTokenCountState } from './countTokens.types';
import { FeatureHandler } from './types';

export const countTokens: FeatureHandler<GlobalTokenCountState> = {
    allTokenHandler: global => {
        ++global._count;
    }
}