= Reading list

// A document can only read files the app mounted in its virtual file system
// (PLAN.md §9). Absolute paths are relative to the project root, never the host.
#read("/etc/passwd")
