import { Token } from '../tokenize';
import { GlobalStateWithGroupState, GroupState } from './handleGroupState.types';
import { WarnOption } from './types';

export type DestinationSet = Partial<{ [dest: string]: true }>;

export interface ControlAndDestinationGroupState extends GroupState {
    destDepth: number;

    destination?: string;
    allDestinations?: DestinationSet;
    ancDestIgnorable?: boolean;
    destIgnorable?: boolean;
}

export interface ControlAndDestinationGlobalState extends GlobalStateWithGroupState<ControlAndDestinationGroupState>, WarnOption {
    _lastLastToken: Token | null | undefined;
    _lastToken: Token | null | undefined;
    _currToken: Token | null | undefined;
}