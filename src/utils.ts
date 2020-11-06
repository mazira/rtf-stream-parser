export function isDef<T>(thing: T | undefined | void): thing is T {
    return typeof thing !== 'undefined';
}

export function isStr(thing: any): thing is string {
    return typeof thing === 'string';
}

export function isNum(thing: any): thing is number {
    return typeof thing === 'number';
}
