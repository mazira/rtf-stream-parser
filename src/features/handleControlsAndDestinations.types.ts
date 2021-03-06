import { Token } from '../tokenize';
import { GlobalStateWithGroupState, GroupState } from './handleGroupState.types';
import { WarnOption } from './types';

export type DestinationSet = Partial<{ [dest: string]: true }>;

export interface ControlAndDestinationGroupState extends GroupState {
    destination?: string;
    allDestinations?: DestinationSet;

    destIgnorableImmediate?: boolean;
    destIgnorable?: boolean;

    destDepth: number;
    destGroupDepth: number;
}

export interface ControlAndDestinationGlobalState extends GlobalStateWithGroupState<ControlAndDestinationGroupState>, WarnOption {
    _lastLastToken: Token | null | undefined;
    _lastToken: Token | null | undefined;
    _currToken: Token | null | undefined;
}
