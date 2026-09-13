// /src/utils/logger.js

export const logger = {
  info: (category, msg, data = null) => {
    console.log(
      `[INFO][${category}] ${new Date().toISOString()} — ${msg}`,
      data || ""
    );
  },

  warn: (category, msg, data = null) => {
    console.warn(
      `[WARN][${category}] ${new Date().toISOString()} — ${msg}`,
      data || ""
    );
  },

  error: (category, msg, data = null) => {
    console.error(
      `[ERROR][${category}] ${new Date().toISOString()} — ${msg}`,
      data || ""
    );
  },

  cycle: (msg) => {
    console.log(`\n===== ${msg} @ ${new Date().toISOString()} =====`);
  }
};
