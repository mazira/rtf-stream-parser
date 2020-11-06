import { ControlToken, GroupEndToken, GroupStartToken, TextToken, Token, TokenType } from '../tokenize';

type Result = true | string | Buffer | void;
export type ControlHandler<G> = (global: G, token: ControlToken,) => Result;
export type ControlHandlers<G> = { [token: string]: ControlHandler<G> }

export type TokenHandler<G, T extends Token> = (global: G, token: T) => Result;

export type TokenHandlers<G> = {
    [TokenType.GROUP_START]?: TokenHandler<G, GroupStartToken>,
    [TokenType.GROUP_END]?: TokenHandler<G, GroupEndToken>,
    [TokenType.CONTROL]?: TokenHandler<G, ControlToken>,
    [TokenType.TEXT]?: TokenHandler<G, TextToken>
}

export type TextHandler<G> = (global: G, data: Buffer | string) => boolean;

export interface FeatureHandler<G> {
    allTokenHandler?: TokenHandler<G, Token>,
    tokenHandlers?: TokenHandlers<G>;
    controlHandlers?: ControlHandlers<G>;
    textHandler?: TextHandler<G>;
    preFlushHandler?: (global: G) => void
}

export interface WarnOption {
    _options: {
        warn: (msg: string) => void;
    };
}