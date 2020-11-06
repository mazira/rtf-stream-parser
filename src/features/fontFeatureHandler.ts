import { isNum, isStr } from '../utils';
import { FontGlobalState } from './fontFeatureHandler.types';
import { ControlHandler, ControlHandlers, FeatureHandler, TextHandler } from './types';

const charsetToCpg: { [charset: number]: number } = {
    0: 1252,
    2: 42,
    77: 10000,
    78: 10001,
    79: 10003,
    80: 10008,
    81: 10002,
    83: 10005,
    84: 10004,
    85: 10006,
    86: 10081,
    87: 10021,
    88: 10029,
    89: 10007,
    128: 932,
    129: 949,
    130: 1361,
    134: 936,
    136: 950,
    161: 1253,
    162: 1254,
    163: 1258,
    177: 1255,
    178: 1256,
    186: 1257,
    204: 1251,
    222: 874,
    238: 1250,
    254: 437,
    255: 850,
};

// Make reverse map of codepages
const codpages: { [charset: number]: true } = {
    // Seen in the wild
    20127: true
};
for (const charset in charsetToCpg) {
    const cpg = charsetToCpg[charset];
    codpages[cpg] = true;
}

const handleThemeFont: ControlHandler<FontGlobalState> = (global, cw) => {
    if (global._state.destination !== 'fonttbl' || !global._fonttbl) {
        throw new Error(cw + ' not in fonttbl');
    }

    const f = global._state.font;
    const fontEntry = f && global._fonttbl[f];
    if (!f || !fontEntry) {
        throw new Error(cw + ' with no current font');
    }

    fontEntry.themeFont = cw.word.slice(1);
};

const handleFontFamily: ControlHandler<FontGlobalState> = (global, cw) => {
    if (global._state.destination !== 'fonttbl' || !global._fonttbl) {
        throw new Error(cw + ' not in fonttbl');
    }

    const f = global._state.font;
    const fontEntry = f && global._fonttbl[f];
    if (!f || !fontEntry) {
        throw new Error(cw + ' with no current font');
    }

    fontEntry.fontFamily = cw.word.slice(1);
};

const fontControlHandlers: ControlHandlers<FontGlobalState> = {
    fonttbl: (global, cw) => {
        if (global._fonttbl) {
            throw new Error('fonttbl already created');
        } else if (global._state.destDepth !== 2) {
            throw new Error('fonttbl not in header');
        }
        global._fonttbl = {}
    },

    // Handle font definition (inside \fonttbl) or font selection (outside \fonttlb)
    f: (global, cw) => {
        if (typeof cw.param === 'undefined') {
            throw new Error('No param for \\f');
        }

        const f = cw.param + '';

        if (global._state.destination === 'fonttbl') {
            // Create font table entry
            global._fonttbl = global._fonttbl || {};
            global._fonttbl[f] = global._fonttbl[f] || {};
        } else if (!global._fonttbl || !global._fonttbl[f]) {
            throw new Error('\\f control word for unknown font ' + f);
        }

        // Set current font
        global._state.font = f;
    },

    // Handle fcharset inside \fonttbl
    fcharset: (global, cw) => {
        if (global._state.destination !== 'fonttbl' || !global._fonttbl) {
            throw new Error('fcharset not in fonttbl');
        }

        const f = global._state.font;
        const fontEntry = f && global._fonttbl[f];
        if (!f || !fontEntry) {
            throw new Error('fcharset with no current font');
        }

        if (!isNum(cw.param)) {
            throw new Error('fcharset with no param');
        }

        if (cw.param !== 1) {
            let cpg = charsetToCpg[cw.param];

            // Somtimes, the \fcharset control word seems to specify a cpg directly...
            // This seems incorrect, but has been found in the wild for 1252 and 20127
            if (!isNum(cpg) && codpages[cw.param]) {
                cpg = cw.param;
            }

            if (!isNum(cpg)) {
                global._options.warn('No codepage for charset ' + cw.param);
            } else {
                fontEntry.fcharsetCpg = cpg;
            }
        }
    },

    // Handle cpg inside \fonttbl
    cpg: (global, cw) => {
        if (global._state.destination !== 'fonttbl' || !global._fonttbl)
            throw new Error('cpg not in fonttbl');

        const f = global._state.font;
        const fontEntry = f && global._fonttbl[f];
        if (!f || !fontEntry) {
            throw new Error('cpg with no current font');
        }

        const cpg = cw.param;
        if (!isNum(cpg)) {
            global._options.warn('No codepage given');
        } else {
            fontEntry.cpg = cpg;
        }
    },

    // \flomajor | \fhimajor | \fdbmajor | \fbimajor | \flominor | \fhiminor | \fdbminor | \fbiminor
    flomajor: handleThemeFont,
    fhimajor: handleThemeFont,
    fdbmajor: handleThemeFont,
    fbimajor: handleThemeFont,
    flominor: handleThemeFont,
    fhiminor: handleThemeFont,
    fdbminor: handleThemeFont,
    fbiminor: handleThemeFont,

    // \fnil | \froman | \fswiss | \fmodern | \fscript | \fdecor | \ftech | \fbidi
    fnil: handleFontFamily,
    froman: handleFontFamily,
    fswiss: handleFontFamily,
    fmodern: handleFontFamily,
    fscript: handleFontFamily,
    fdecor: handleFontFamily,
    ftech: handleFontFamily,
    fbidi: handleFontFamily,
}

const fontTextHandler: TextHandler<FontGlobalState> = (global, data) => {
    if (global._state.destination === 'fonttbl') {
        const f = global._state.font;
        const fontEntry = f && global._fonttbl && global._fonttbl[f];

        if (!f || !fontEntry) {
            throw new Error('font text with no current font');
        }

        // Has trailing semicolon
        if (!isStr(data)) {
            data = data.toString('latin1');
        }

        // It's hard to know the proper encoding at this point, so replace any non-ASCII chars
        // with string escapes
        data = data.replace(/[^\x00-\x7F]/g, c => {
            const hex = c.charCodeAt(0).toString(16).toUpperCase();
            return '\\u' + '0000'.slice(0, 4 - hex.length) + hex;
        });

        let str = (fontEntry.fontName || '') + data;

        if (str.endsWith(';')) {
            str = str.substr(0, str.length - 1);

            // Trim quotes
            if (str.length > 2 && str.startsWith('"') && str.endsWith('"')) {
                str = str.substr(1, str.length - 2);
            }
        }

        fontEntry.fontName = str;
        return true;
    }

    return false;
}

export const fontFeatureHandler: FeatureHandler<FontGlobalState> = {
    controlHandlers: fontControlHandlers,
    textHandler: fontTextHandler
}
