import { ControlAndDestinationGlobalState } from './handleControlsAndDestinations.types';
import { FeatureHandler } from './types';

export const ignoreOptionalDestOutput: FeatureHandler<ControlAndDestinationGlobalState> = {
    outputDataFilter: global => {
        // Ignore output from optional destinations
        if (global._state.destIgnorable) {
            return true;
        }

        // Ignore output from known ignore destinations
        const allDests = global._state.allDestinations;
        if (allDests && (allDests['fonttbl'] || allDests['colortbl'] || allDests['stylesheet'] || allDests['pntext'])) {
            return true;
        }
    }
}
