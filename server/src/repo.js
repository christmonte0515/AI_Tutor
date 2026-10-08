// Shared read queries used by both admin and student routes.

function catalog(db) {
  const domains = db.prepare('SELECT id, name, sort_order FROM domains ORDER BY sort_order, name').all();
  const subjects = db
    .prepare('SELECT id, domain_id, name, teacher_name, description, keywords, icon FROM subjects ORDER BY name')
    .all();
  return domains.map((d) => ({
    id: d.id,
    name: d.name,
    subjects: subjects
      .filter((s) => s.domain_id === d.id)
      .map((s) => ({
        id: s.id,
        domainId: s.domain_id,
        name: s.name,
        teacherName: s.teacher_name,
        description: s.description,
        keywords: s.keywords,
        icon: s.icon,
      })),
  }));
}

function subjectsWithDomain(db) {
  return db
    .prepare(
      `SELECT s.id, s.name, s.teacher_name, s.description, s.keywords, s.domain_id, d.name AS domain_name
       FROM subjects s JOIN domains d ON d.id = s.domain_id`
    )
    .all();
}

function activeGoals(db) {
  return db
    .prepare('SELECT text FROM learning_goals WHERE active = 1 ORDER BY sort_order, id')
    .all()
    .map((g) => g.text);
}

function activeRestrictions(db) {
  return db.prepare('SELECT id, kind, description, keywords FROM restrictions WHERE active = 1').all();
}

function studentSubjectIds(db, studentId) {
  return db
    .prepare('SELECT subject_id FROM student_subjects WHERE student_id = ?')
    .all(studentId)
    .map((r) => r.subject_id);
}

module.exports = { catalog, subjectsWithDomain, activeGoals, activeRestrictions, studentSubjectIds };
