// PropertiesService not available in web — use in-memory store per user
const store = {};

module.exports = async function getTodoList([userId]) {
  if (!userId) return '[]';
  return store[userId] || '[]';
};

module.exports.save = function(userId, json) {
  if (userId && json) store[userId] = json;
  return true;
};
