import { ControlToken } from '../tokenize';

export type CWHandler<G, S> = (global: G, state: S, token: ControlToken, count: number, warn: (msg: string) => void) => void;

export type CWHandlers<G, S> = { [token: string]: CWHandler<G, S> }

export type TextHandler<G, S> = (global: G, state: S, data: Buffer | string) => boolean;

export interface BaseState {
    destination?: string;
    groupDepth: number;
    destDepth: number;
}