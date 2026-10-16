CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, country TEXT NOT NULL, source TEXT NOT NULL,
  product TEXT NOT NULL, contact TEXT NOT NULL, stage TEXT NOT NULL,
  owner TEXT NOT NULL, last_contact TEXT NOT NULL, next_follow_up TEXT NOT NULL,
  notes TEXT NOT NULL, identity_key TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  revision INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL,
  changed_at TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL,
  UNIQUE(customer_id, revision)
);
CREATE INDEX IF NOT EXISTS audit_customer ON audit_log(customer_id, id);
CREATE TRIGGER IF NOT EXISTS audit_customer_created AFTER INSERT ON customers BEGIN
  INSERT INTO audit_log(customer_id, revision, action, actor, changed_at, before_json, after_json)
  VALUES(NEW.id, NEW.revision, 'created', NEW.updated_by, NEW.updated_at, NULL,
    json_object('name',NEW.name,'country',NEW.country,'source',NEW.source,'product',NEW.product,
    'contact',NEW.contact,'stage',NEW.stage,'owner',NEW.owner,'lastContact',NEW.last_contact,
    'nextFollowUp',NEW.next_follow_up,'notes',NEW.notes));
END;
CREATE TRIGGER IF NOT EXISTS audit_customer_updated AFTER UPDATE ON customers BEGIN
  INSERT INTO audit_log(customer_id, revision, action, actor, changed_at, before_json, after_json)
  VALUES(NEW.id, NEW.revision, 'updated', NEW.updated_by, NEW.updated_at,
    json_object('name',OLD.name,'country',OLD.country,'source',OLD.source,'product',OLD.product,
    'contact',OLD.contact,'stage',OLD.stage,'owner',OLD.owner,'lastContact',OLD.last_contact,
    'nextFollowUp',OLD.next_follow_up,'notes',OLD.notes),
    json_object('name',NEW.name,'country',NEW.country,'source',NEW.source,'product',NEW.product,
    'contact',NEW.contact,'stage',NEW.stage,'owner',NEW.owner,'lastContact',NEW.last_contact,
    'nextFollowUp',NEW.next_follow_up,'notes',NEW.notes));
END;
