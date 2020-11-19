import { checkVersion } from './features/checkVersion';
import { countTokens } from './features/countTokens';
import { handleCharacterSet } from './features/handleCharacterSet';
import { handleControlsAndDestinations } from './features/handleControlsAndDestinations';
import { handleDeEncapsulation } from './features/handleDeEncapsulation';
import { DeEncapsulationGlobalState, DeEncapsulationGroupState } from './features/handleDeEncapsulation.types';
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

interface DeEncGroupState extends ProcessTokensGroupState, DeEncapsulationGroupState { }

interface DeEncGlobalState extends ProcessTokensGlobalState, DeEncapsulationGlobalState, GlobalStateWithGroupState<DeEncGroupState> {
    _options: DeEncapsulationGlobalState['_options'] & WarnOption['_options'],
    _state: DeEncGroupState;
    _rootState: DeEncGroupState;
}

interface DeEncapsulateExtraOptions {
    htmlEncodeNonAscii: boolean;
    htmlFixContentType: boolean;
    mode: Mode;
    prefix: boolean;
}

const deEncExtraDefaultOptions: DeEncapsulateExtraOptions = {
    htmlEncodeNonAscii: false,
    htmlFixContentType: false,
    mode: 'either',
    prefix: false
}

export type DeEncapsulateOptions = DeEncapsulateExtraOptions & ProcessTokensOptions;

function htmlEntityEncode(str: string) {
    const pieces: string[] = [];
    let ascii = true;
    for (const char of str) {
        const codepoint = char.codePointAt(0) as number;
        if (codepoint > 0x7F) {
            ascii = false;
            pieces.push('&#x' + codepoint.toString(16) + ';');
        } else {
            pieces.push(char);
        }
    }

    const out = ascii ? str : pieces.join('');
    return out;
}

const rxCharset = /(\bcharset=)([\w-]+)(")/i;

export class DeEncapsulate extends ProcessTokens implements DeEncGlobalState {
    public _options: ProcessTokensOptions & DeEncapsulateExtraOptions;
    public readonly _featureHandlers: FeatureHandler<DeEncGlobalState>[] = [
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


    private readonly _bufdIsHtml = false;

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

    get isHtml() {
        return this._fromhtml;
    }

    get isText() {
        return this._fromtext;
    }

    get originalHtmlCharset() {
        return this._originalHtmlCharset;
    }

    _getOutputAsString(data: string | Buffer, font?: FontTableEntry): [string, boolean] {
        const result = super._getOutputAsString(data, font);

        if (result && this._bufdIsHtml && this._options.htmlFixContentType && !this._didHtmlCharsetReplace) {
            result[0] = result[0].replace(rxCharset, (match, pre, charset, post) => {
                this._didHtmlCharsetReplace = true;
                this._originalHtmlCharset = charset;
                return pre + 'UTF-8' + post;
            });
        }

        if (result && this._fromhtml && this._options.htmlEncodeNonAscii) {
            result[0] = htmlEntityEncode(result[0]);
        }

        return result;
    }

    _getCurrentFont(): FontTableEntry | undefined {
        const allDests = this._state.allDestinations || {};
        const insideHtmltag = !!allDests['htmltag'];

        return insideHtmltag ? undefined : super._getCurrentFont();
    }
}

export default DeEncapsulate;
