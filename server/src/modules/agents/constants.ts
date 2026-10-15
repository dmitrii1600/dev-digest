/** Constants for the agents module. */

/** Initial config version recorded for a newly-created agent. */
export const INITIAL_AGENT_VERSION = 1;

/** Default agent description when none is supplied on insert. */
export const DEFAULT_AGENT_DESCRIPTION = '';

/** Completed runs per agent that feed `GET /agents/run-estimates` (the most recent N). */
export const RUN_ESTIMATE_WINDOW = 20;
