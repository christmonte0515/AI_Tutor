// Usage: npm run create-admin -- teacher@school.edu "a-long-password" ["Display Name"]
const database = require('../src/db');
const { hashPassword } = require('../src/security');

const [email, password, displayName] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npm run create-admin -- <email> <password> [display name]');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Teacher passwords must be at least 10 characters.');
  process.exit(1);
}

const db = database.open();
database.seed(db);
const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email.toLowerCase());
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin', active = 1 WHERE id = ?").run(hashPassword(password), existing.id);
  console.log(`Updated ${email} as a teacher account.`);
} else {
  db.prepare("INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, 'admin', ?)").run(
    email.toLowerCase(),
    hashPassword(password),
    displayName || email.split('@')[0]
  );
  console.log(`Created teacher account ${email}.`);
}
