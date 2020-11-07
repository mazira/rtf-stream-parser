import { TokenCountGlobalState } from './countTokens.types';
import { ControlAndDestinationGroupState } from './handleControlsAndDestinations.types';
import { GlobalStateWithGroupState } from './handleGroupState.types';

export type DestinationSet = Partial<{ [dest: string]: true }>;

export interface DeEncapsulationGroupState extends ControlAndDestinationGroupState {
    htmlrtf?: boolean;
}

export interface DeEncapsulationGlobalState extends GlobalStateWithGroupState<DeEncapsulationGroupState>, TokenCountGlobalState {
    _options: {
        mode: 'text' | 'html' | 'either'
        prefix: boolean;
    }
    _fromhtml: boolean;
    _fromtext: boolean;
}