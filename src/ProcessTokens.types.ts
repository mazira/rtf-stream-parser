import { TokenCountGlobalState } from './features/countTokens.types';
import { CharacterSetGlobalState } from './features/handleCharacterSet.types';
import { ControlAndDestinationGlobalState, ControlAndDestinationGroupState } from './features/handleControlsAndDestinations.types';
import { FontGlobalState, FontGroupState, FontTableEntry } from './features/handleFonts.types';
import { GlobalStateWithGroupState, GroupGlobalState, GroupState } from './features/handleGroupState.types';
import { UnicodeGlobalState, UnicodeGroupState } from './features/handleUnicode.types';

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
}

export interface ProcessTokensGroupState extends GroupState, UnicodeGroupState, ControlAndDestinationGroupState, FontGroupState { }

export interface ProcessTokensGlobalState extends
    TokenCountGlobalState,
    GroupGlobalState,
    UnicodeGlobalState,
    ControlAndDestinationGlobalState,
    CharacterSetGlobalState,
    FontGlobalState,
    GlobalStateWithGroupState<ProcessTokensGroupState> {
    _state: ProcessTokensGroupState;
    _rootState: ProcessTokensGroupState;
}

export const enum TextType {
    Unicode,
    Codepage,
    Font,
    Symbol
}

interface BufferedBase {
    type: TextType;
    data: Buffer[] | string[] | (Buffer | string)[];
    font?: Readonly<FontTableEntry>;
    codepage?: number;
}

export interface BufferedUnicodeText extends BufferedBase {
    type: TextType.Unicode;
    data: string[];
}

export interface BufferedCodepageText extends BufferedBase {
    type: TextType.Codepage;
    data: Buffer[];
    codepage: number;
}

export interface BufferedFontText extends BufferedBase {
    type: TextType.Font;
    data: Buffer[];
    font: Readonly<FontTableEntry>;
}

export interface BufferedSymbolText extends BufferedBase {
    type: TextType.Symbol;
    data: (Buffer | string)[];
    font: Readonly<FontTableEntry>;
}

export type BufferedOutput = BufferedUnicodeText | BufferedCodepageText | BufferedFontText | BufferedSymbolText;
