/**
 * Raised whenever a client command or server event changes in a way the other side cannot read. The hosted web
 * app talks to hosts of any release, so it compares this number before connecting and refuses a host that differs.
 */
export const PROTOCOL_VERSION = 3;
