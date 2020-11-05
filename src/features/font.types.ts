import { BaseState } from "./types";

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

export interface FontGlobals {
    _fonttbl?: FontTable;
}

export interface FontState extends BaseState {
    font?: string;
}