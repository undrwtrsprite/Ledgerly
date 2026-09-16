// Single source of truth for release versions.
// package.json.version mirrors SHELL_VERSION. The build and the update
// manifest must use FRONTEND_VERSION, never a hardcoded changelog string.
export const FRONTEND_VERSION: string = '1.7.0'
export const SHELL_VERSION: string = '1.6.1'
