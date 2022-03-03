import { checkVersion } from './features/checkVersion';
import { countTokens } from './features/countTokens';
import { handleCharacterSet } from './features/handleCharacterSet';
import { handleControlsAndDestinations } from './features/handleControlsAndDestinations';
import { handleDeEncapsulation } from './features/handleDeEncapsulation';
import { DeEncapsulationGlobalState } from './features/handleDeEncapsulation.types';
import { handleFonts } from './features/handleFonts';
import { FontTableEntry } from './features/handleFonts.types';
import { handleGroupState } from './features/handleGroupState';
import { GlobalStateWithGroupState } from './features/handleGroupState.types';
import { handleOutput } from './features/handleOutput';
import { handleUnicodeSkip } from './features/handleUnicodeSkip';
import { handleTextEscapes } from './features/textEscapes';
import { FeatureHandler, WarnOption } from './features/types';
import { ProcessTokens, procTokensDefaultOptions } from './ProcessTokens';
import { ProcessTokensGlobalState, ProcessTokensGroupState, ProcessTokensOptions } from './ProcessTokens.types';

export type Mode = 'text' | 'html' | 'either';

type DeEncGroupState = ProcessTokensGroupState;

interface DeEncGlobalState extends ProcessTokensGlobalState, DeEncapsulationGlobalState, GlobalStateWithGroupState<DeEncGroupState> {
    _options: DeEncapsulationGlobalState['_options'] & WarnOption['_options'],
    _state: DeEncGroupState;
    _rootState: DeEncGroupState;
}

interface DeEncapsulateExtraOptions {
    htmlEncodeNonAscii: boolean;
    htmlFixContentType: boolean;
    htmlPreserveSpaces: boolean;
    mode: Mode;
    prefix: boolean;
    outlookQuirksMode: boolean;
}

const deEncExtraDefaultOptions: DeEncapsulateExtraOptions = {
    htmlEncodeNonAscii: false,
    htmlFixContentType: false,
    htmlPreserveSpaces: false,
    mode: 'either',
    prefix: false,
    outlookQuirksMode: false,
};

export type DeEncapsulateOptions = DeEncapsulateExtraOptions & ProcessTokensOptions;

function htmlEntityEncode(str: string) {
    const pieces: string[] = [];
    let ascii = true;
    for (const char of str) {
        if (char === '<') {
            pieces.push('&lt;');
        } else if (char === '>') {
            pieces.push('&gt;');
        } else if (char === '&') {
            pieces.push('&amp;');
        } else {
            const codepoint = char.codePointAt(0) as number;
            if (codepoint === 0xA0) {
                ascii = false;
                pieces.push('&nbsp;');
            } else if (codepoint > 0x7F) {
                ascii = false;
                pieces.push('&#x' + codepoint.toString(16) + ';');
            } else {
                pieces.push(char);
            }
        }
    }

    const out = ascii ? str : pieces.join('');
    return out;
}

const mapHtml: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
};

function escapeHtml5(text: string): string {
    return text.replace(/[&<>]/g, (m => mapHtml[m] || ''));
}

const rxCharset = /(\bcharset=)([\w-]+)(")/i;

export class DeEncapsulate extends ProcessTokens implements DeEncGlobalState {
    public _options: ProcessTokensOptions & DeEncapsulateExtraOptions;
    public readonly _featureHandlers: FeatureHandler<ProcessTokensGlobalState>[] = [
        countTokens,
        checkVersion,
        handleGroupState,
        handleUnicodeSkip,

        handleControlsAndDestinations,
        handleCharacterSet,
        handleFonts,
        handleDeEncapsulation,

        handleOutput,
        handleTextEscapes,
    ];

    // These members are all public to allow the handler functions to access without TS complaining...
    public readonly _rootState: DeEncGroupState = { uc: 1, groupDepth: 0, destDepth: 0, destGroupDepth: 0 };
    public _state: DeEncGroupState = this._rootState;

    public _fromhtml = false;
    public _fromtext = false;
    public _didHtmlCharsetReplace = false;
    public _originalHtmlCharset: string | undefined;

    /**
     * @param {('text'|'html'|'either')-} mode Whether to de-encapsulate only text, html, or both. Will emit an error if stream doesn't match. Defaults to html.
     * @param {boolean} prefix Whether to prefix the output text with "html:" or "text:" depending on the encapsulation mode
     */
    constructor(options?: Partial<DeEncapsulateOptions>) {
        super(options);
        this._options = {
            ...procTokensDefaultOptions,
            ...deEncExtraDefaultOptions,
            ...options
        };
    }

    get isHtml(): boolean {
        return this._fromhtml;
    }

    get isText(): boolean {
        return this._fromtext;
    }

    get originalHtmlCharset(): string | undefined {
        return this._originalHtmlCharset;
    }

    _getOutputAsString(data: string | Buffer, font?: FontTableEntry): [string, boolean] {
        // eslint-disable-next-line prefer-const
        let [outStr, areSymbolFontCodepoints] = super._getOutputAsString(data, font);

        if (this._fromhtml) {
            const insideHtmltag = !!this._state.allDestinations?.['htmltag'];
            if (insideHtmltag) {
                if (this._options.htmlFixContentType && !this._didHtmlCharsetReplace) {
                    outStr = outStr.replace(rxCharset, (match, pre, charset, post) => {
                        this._didHtmlCharsetReplace = true;
                        this._originalHtmlCharset = charset;
                        return pre + 'UTF-8' + post;
                    });
                }
            } else {
                if (this._options.htmlPreserveSpaces) {
                    if (outStr === ' ') {
                        outStr = '\u00A0';
                    } else {
                        outStr = outStr
                            .replace(/  +/g, match => ' ' + '\u00A0'.repeat(match.length - 1))
                            .replace(/^ +/, match => '\u00A0'.repeat(match.length))
                            .replace(/ +$/, match => '\u00A0'.repeat(match.length));
                    }
                }

                // Escape non-tag text
                if (this._options.htmlEncodeNonAscii) {
                    outStr = htmlEntityEncode(outStr);
                } else {
                    outStr = escapeHtml5(outStr);
                }
            }
        }

        return [outStr, areSymbolFontCodepoints];
    }

    _getCurrentFont(): FontTableEntry | undefined {
        const allDests = this._state.allDestinations || {};
        const insideHtmltag = !!allDests['htmltag'];

        return insideHtmltag ? undefined : super._getCurrentFont();
    }
}

export default DeEncapsulate;
