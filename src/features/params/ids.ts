/**
 An instance id may start with a digit, so a control's id carries a prefix to
 stay a valid CSS selector as well as a valid HTML id.
 */
export function controlId(
	instanceId: string,
	paramKey: string,
	suffix?: string,
): string {
	return `param-${instanceId}-${paramKey}${suffix === undefined ? '' : `-${suffix}`}`;
}
