import logging from './security-log.cjs';
// A side-effect dependency runs before the entry point's remaining static imports.
logging.install();
