import { GlobalTokenCountState } from './countTokens.types';
import { ControlAndDestinationGroupState } from './handleControlsAndDestinations.types';
import { GlobalStateWithGroupState } from './handleGroupState.types';

export type DestinationSet = Partial<{ [dest: string]: true }>;

export interface DeEncapsulationGroupState extends ControlAndDestinationGroupState {
}

export interface DeEncapsulationGlobalState extends GlobalStateWithGroupState<DeEncapsulationGroupState>, GlobalTokenCountState {
    _options: {
        mode: 'text' | 'html' | 'either'
        prefix: boolean;
    }
    _fromhtml: boolean;
    _fromtext: boolean;
}