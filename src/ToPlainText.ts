import { checkVersion } from './features/checkVersion';
import { countTokens } from './features/countTokens';
import { handleCharacterSet } from './features/handleCharacterSet';
import { handleControlsAndDestinations } from './features/handleControlsAndDestinations';
import { handleFonts } from './features/handleFonts';
import { handleGroupState } from './features/handleGroupState';
import { handleOutput } from './features/handleOutput';
import { handleUnicodeSkip } from './features/handleUnicodeSkip';
import { ignoreOptionalDestOutput } from './features/ignoreOptionalDestOutput';
import { handleTextEscapes } from './features/textEscapes';
import { FeatureHandler } from './features/types';
import { ProcessTokens } from './ProcessTokens';
import { ProcessTokensGlobalState, ProcessTokensOptions } from './ProcessTokens.types';

export class ToPlainText extends ProcessTokens {
    public _options: ProcessTokensOptions;
    public readonly _featureHandlers: FeatureHandler<ProcessTokensGlobalState>[] = [
        countTokens,
        checkVersion,
        handleGroupState,
        handleUnicodeSkip,

        handleControlsAndDestinations,
        handleCharacterSet,
        handleFonts,
        ignoreOptionalDestOutput,

        handleOutput,
        handleTextEscapes,
    ];

    constructor(options?: Partial<ProcessTokensOptions>) {
        super(options);
    }
}
