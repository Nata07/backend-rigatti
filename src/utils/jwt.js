const jwt = require("jsonwebtoken");

function createJwtSigner({ secret, expiresIn }) {
  return function signToken(payload) {
    return jwt.sign(payload, secret, { expiresIn });
  };
}

function createJwtVerifier({ secret }) {
  return function verifyToken(token) {
    return jwt.verify(token, secret);
  };
}

module.exports = {
  createJwtSigner,
  createJwtVerifier,
};
