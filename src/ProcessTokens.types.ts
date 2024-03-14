import { TokenCountGlobalState } from './features/countTokens.types';
import { CharacterSetGlobalState } from './features/handleCharacterSet.types';
import { ControlAndDestinationGlobalState, ControlAndDestinationGroupState } from './features/handleControlsAndDestinations.types';
import { FontGlobalState, FontGroupState, FontTableEntry } from './features/handleFonts.types';
import { GlobalStateWithGroupState, GroupGlobalState, GroupState } from './features/handleGroupState.types';
import { OutputGlobalState } from './features/handleOutput.types';
import { UnicodeSkipGlobalState, UnicodeSkipGroupState } from './features/handleUnicodeSkip.types';

export type StringDecoder = (buf: Buffer, enc: string) => string;
export type StringEncoder = (str: string, enc: string) => Buffer;
export type LowLevelDecoder = (buf: Buffer, codepage: number, fontInfo: Readonly<FontTableEntry> | undefined, decoder: StringDecoder) => string | undefined;

export interface ProcessTokensOptions {
    decode: StringDecoder;
    encode: StringEncoder;
    outputMode: 'string' | 'buffer-utf8' | 'buffer-default-cpg';
    replaceSymbolFontChars: boolean | {
        [font: string]: boolean
    };
    warn: (msg: string) => void;
    allowCp0?: boolean;
}

export interface ProcessTokensGroupState extends GroupState, UnicodeSkipGroupState, ControlAndDestinationGroupState, FontGroupState { }

export interface ProcessTokensGlobalState extends
    TokenCountGlobalState,
    GroupGlobalState,
    UnicodeSkipGlobalState,
    OutputGlobalState,
    ControlAndDestinationGlobalState,
    CharacterSetGlobalState,
    FontGlobalState,
    GlobalStateWithGroupState<ProcessTokensGroupState> {
    _state: ProcessTokensGroupState;
    _rootState: ProcessTokensGroupState;
}
