import { WarnOption } from "./types";

export interface GlobalStateWithGroupState<T> {
    _state: T;
    _rootState: T;
}

export interface GroupState extends Object {
    groupDepth: number;
}

export interface GroupGlobalState extends GlobalStateWithGroupState<GroupState>, WarnOption {
    _done: boolean;
}
