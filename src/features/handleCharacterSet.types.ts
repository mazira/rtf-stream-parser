import { ControlAndDestinationGlobalState } from './handleControlsAndDestinations.types';
import { WarnOption } from './types';

export interface CharacterSetGlobalState extends ControlAndDestinationGlobalState, WarnOption {
    _ansicpg: boolean;
    _cpg: number;
}
