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
  const { baseUrl, model } = config.ollama;
  const status = await llm.health();
  if (!status.ok) {
    console.warn(`Ollama is not reachable at ${baseUrl} (${status.error}). Start it with: ollama serve`);
  } else if (!status.modelInstalled) {
    console.warn(
      `Ollama is running but model "${model}" is not installed. Installed: ${status.models.join(', ') || 'none'}. ` +
        `Run: ollama pull ${model}  (or set OLLAMA_MODEL)`
    );
  } else {
    console.log(`Ollama OK, using model "${model}". Loading it into memory...`);
    llm
      .warmUp()
      .then(() => console.log('Model loaded and ready.'))
      .catch((err) => console.warn(`Could not preload the model: ${err.message}`));
  }
});
