function buildRegistrationPayload(overrides = {}) {
  return {
    name: "Alice",
    email: "alice@example.com",
    password: "Password123",
    companyName: "Acme",
    ...overrides,
  };
}

function buildProductPayload(overrides = {}) {
  return {
    name: "Keyboard",
    description: "Mechanical keyboard",
    price: 120,
    category: "Accessories",
    ...overrides,
  };
}

module.exports = {
  buildProductPayload,
  buildRegistrationPayload,
};
