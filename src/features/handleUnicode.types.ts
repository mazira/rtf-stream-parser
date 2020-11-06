import { GlobalStateWithGroupState } from "./handleGroupState.types";

export interface UnicodeGroupState {
    uc: number;
}

export interface UnicodeGlobalState extends GlobalStateWithGroupState<UnicodeGroupState> {
    _skip: number;
}