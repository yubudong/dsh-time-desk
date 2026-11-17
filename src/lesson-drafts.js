// Local browser drafts are separate from saved workbench records and backups.
export function createLessonDraftStore(storage) {
  const memory = new Map();
  return {
    read(key) {
      if (memory.has(key)) return structuredClone(memory.get(key));
      try {
        const raw = storage?.getItem(key);
        if (!raw) return null;
        const record = JSON.parse(raw);
        if (
          record?.format !== 1 ||
          !record.values ||
          typeof record.values !== "object" ||
          Array.isArray(record.values) ||
          !record.base
        )
          return null;
        memory.set(key, record);
        return structuredClone(record);
      } catch {
        return null;
      }
    },
    put(key, record) {
      memory.set(key, structuredClone(record));
      try {
        if (!storage) return false;
        storage.setItem(key, JSON.stringify(record));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      memory.delete(key);
      try {
        storage?.removeItem(key);
      } catch {}
    },
  };
}
