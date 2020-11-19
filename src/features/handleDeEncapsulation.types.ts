import { TokenCountGlobalState } from './countTokens.types';
import { ControlAndDestinationGroupState } from './handleControlsAndDestinations.types';
import { GlobalStateWithGroupState } from './handleGroupState.types';
import { OutputGlobalState } from './handleOutput.types';

export type DestinationSet = Partial<{ [dest: string]: true }>;

export interface DeEncapsulationGroupState extends ControlAndDestinationGroupState {
    htmlrtf?: boolean;
}

export interface DeEncapsulationGlobalState extends GlobalStateWithGroupState<DeEncapsulationGroupState>, TokenCountGlobalState, OutputGlobalState {
    _options: {
        mode: 'text' | 'html' | 'either'
        prefix: boolean;
    }
    _fromhtml: boolean;
    _fromtext: boolean;
}
