import { system } from '../helper/system/system'
import { AppSystemProp } from '../helper/system/system-props'

/**
 * Master rollout switch for the exact-release MCP tools (default off). Read live per call — `getBoolean`
 * reads the env each time, so flipping AP_EXACT_RELEASE_TOOLS_ENABLED takes effect without a process restart.
 * Owned by mcp so consumers (mcp/tools) depend on the flag, never the reverse. When off: none of the five
 * exact-release tools register through activepiecesTools.
 */
export function isExactReleaseToolsEnabled(): boolean {
    return system.getBoolean(AppSystemProp.EXACT_RELEASE_TOOLS_ENABLED) ?? false
}

// Alias for callers that reference the singular or shorter name — same live default-off flag.
export const isExactReleaseEnabled = isExactReleaseToolsEnabled
