export interface OutputGlobalState {
    _bufferedUnicodeOutput?: string[];
    _bufferedBinaryOutput?: Buffer[];
    _pushOutput: (data: string | Buffer) => void;
}
