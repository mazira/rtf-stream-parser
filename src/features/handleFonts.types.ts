import { ControlAndDestinationGroupState } from './handleControlsAndDestinations.types';
import { GlobalStateWithGroupState } from './handleGroupState.types';
import { WarnOption } from './types';

export interface FontTableEntry {
    cpg?: number;
    fcharsetCpg?: number;
    themeFont?: string;
    fontFamily?: string;
    fontName?: string;
}

export interface FontTable {
    [font: string]: FontTableEntry | undefined;
}

export interface FontGroupState extends ControlAndDestinationGroupState {
    font?: string;
}

export interface FontGlobalState extends GlobalStateWithGroupState<FontGroupState>, WarnOption {
    _deff?: string;
    _fonttbl?: FontTable;
    _constructingFontTableEntry?: FontTableEntry;
    _constructingFontTable?: boolean;
    _constructingFontTableKey?: string;
}
