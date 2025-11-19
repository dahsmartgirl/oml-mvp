// db.js

const db = new Dexie('OMLDatabase');

// Define the database schema.
db.version(1).stores({
  // The 'memories' table will store each memory object.
  // 'id' is the primary key.
  // '++id' would mean auto-incrementing, but we use custom string IDs, so just 'id'.
  // '*tags' creates a multi-entry index on the tags array, allowing fast tag-based queries.
  // 'created_at' is indexed for sorting by date.
  memories: 'id, text, summary, *tags, created_at, page_url, source',

  // The 'kvstore' (key-value store) is for single pieces of data, like the profile.
  kvstore: 'key',
});

/**
 * Fetches the user profile.
 * @returns {Promise<object>} The profile object or an empty object.
 */
async function getProfile() {
  const entry = await db.kvstore.get('profile');
  return entry ? entry.value : {};
}

/**
 * Updates the user profile.
 * @param {object} newProfileData - The new data to merge with the existing profile.
 * @returns {Promise<void>}
 */
async function updateProfile(newProfileData) {
  const existing = await getProfile();
  const updated = { ...existing, ...newProfileData };
  await db.kvstore.put({ key: 'profile', value: updated });
}

// We will add more functions here as we refactor other files.