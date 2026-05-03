const bcrypt = require("bcrypt");

function createPasswordHasher(saltRounds) {
  return async function hashPassword(password) {
    return bcrypt.hash(password, saltRounds);
  };
}

function createPasswordVerifier() {
  return async function comparePassword(password, passwordHash) {
    return bcrypt.compare(password, passwordHash);
  };
}

module.exports = {
  createPasswordHasher,
  createPasswordVerifier,
};
