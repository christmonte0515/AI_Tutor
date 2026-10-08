const config = require('./config');
const database = require('./db');
const llm = require('./llm');
const { createApp } = require('./app');

const db = database.open();
database.seed(db);

const purge = () => {
  const n = database.purgeOldPromptLogs(db);
  if (n) console.log(`[retention] deleted ${n} prompt log entries older than ${config.promptRetentionDays} days`);
};
purge();
setInterval(purge, 6 * 60 * 60 * 1000).unref();

const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;

createApp(db).listen(config.port, config.host, async () => {
  console.log(`AI Tutor server listening on http://${config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  if (!admins) {
    console.warn('No teacher (admin) account exists yet. Create one with: npm run create-admin -- <email> <password>');
  }
  const status = await llm.health();
  if (!status.ok) {
    console.warn(`LM Studio is not reachable at ${config.lmStudio.baseUrl} (${status.error}). Start the LM Studio server.`);
  } else if (!status.modelLoaded) {
    console.warn(
      `LM Studio is running but model "${config.lmStudio.model}" is not listed. Available: ${status.models.join(', ') || 'none'}. ` +
        'Load Qwen3 1.7B in LM Studio or set LMSTUDIO_MODEL to the exact model id.'
    );
  } else {
    console.log(`LM Studio OK, using model "${config.lmStudio.model}"`);
  }
});
