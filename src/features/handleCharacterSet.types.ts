import { ControlAndDestinationGlobalState } from './handleControlsAndDestinations.types';

export interface CharacterSetGlobalState extends ControlAndDestinationGlobalState {
    _ansicpg: boolean;
    _cpg: number;
}